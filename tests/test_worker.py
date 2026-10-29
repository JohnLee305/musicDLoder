import contextlib
import copy
import io
import json
import math
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
import album_worker as w
from mutagen.id3 import ID3
from mutagen.mp3 import MP3
from PIL import Image


class WorkerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'tone.wav'
        with wave.open(str(self.source), 'wb') as f:
            f.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
            f.writeframes(b''.join(struct.pack('<h', int(8000 * math.sin(i * 440 * math.tau / 44100))) for i in range(44100)))
        out = io.BytesIO(); Image.new('RGB', (600, 600), '#375837').save(out, 'JPEG'); self.cover = out.getvalue()
        self.album = {'id': 'MPRE_test', 'title': '시험 앨범', 'artist': '테스트 가수', 'year': '2026', 'cover': 'https://lh3.googleusercontent.com/test', 'compilation': False,
                      'tracks': [{'id': 'abcdefghijk', 'title': '첫 번째 곡', 'artist': '테스트 가수 feat. 손님', 'number': 1, 'disc': 1, 'duration': '0:01', 'available': True}]}
        self.request = {'album': self.album, 'root': str(self.root / 'music'), 'bitrate': 256}
        self.calls = 0

    def test_authenticated_errors_do_not_persist_credentials(self):
        self.request['cookies'] = [{'name': 'session', 'value': 'fake-sensitive-token', 'domain': '.youtube.com'}]
        def fail(*args):
            raise RuntimeError('server error fake-sensitive-token')
        with contextlib.redirect_stdout(io.StringIO()):
            result = w.download_album(self.request, downloader=fail, cover_loader=lambda _: self.cover)
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('fake-sensitive-token', json.dumps(result))
        for f in (self.root / 'music').rglob('*.json'):
            self.assertNotIn('fake-sensitive-token', f.read_text())

    def tearDown(self): self.temp.cleanup()
    def source_fn(self, *args): self.calls += 1; return self.source
    def run_job(self, downloader=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return w.download_album(self.request, downloader or self.source_fn, lambda _: self.cover)

    def test_mp3_unicode_cover_and_album_tags(self):
        result = self.run_job(); self.assertEqual(result['status'], 'done')
        file = next(Path(result['path']).glob('*.mp3')); tags = ID3(file); audio = MP3(file)
        self.assertEqual(tags.version, (2, 3, 0))
        self.assertEqual(str(tags['TALB']), '시험 앨범')
        self.assertEqual(str(tags['TPE2']), '테스트 가수')
        self.assertEqual(str(tags['TRCK']), '1/1')
        self.assertEqual(tags.getall('APIC')[0].mime, 'image/jpeg')
        self.assertGreater(audio.info.length, .9)
        self.assertEqual(audio.info.sample_rate, 44100)
        self.assertEqual(audio.info.channels, 2)
        self.assertGreater(audio.info.bitrate, 250000)

    def test_retry_keeps_completed_track(self):
        result = self.run_job(); file = next(Path(result['path']).glob('*.mp3')); before = file.read_bytes()
        self.run_job(); self.assertEqual(self.calls, 1); self.assertEqual(before, file.read_bytes())

    def test_existing_unmanaged_album_is_preserved(self):
        existing = Path(self.request['root']) / '테스트 가수' / '시험 앨범'
        existing.mkdir(parents=True); original = existing / '01 첫 번째 곡.mp3'; original.write_bytes(b'original')
        result = self.run_job()
        self.assertNotEqual(result['path'], str(existing)); self.assertEqual(original.read_bytes(), b'original')

    def test_failed_track_can_retry_without_redownloading_success(self):
        second = {**self.album['tracks'][0], 'id': 'lmnopqrstuv', 'title': '두 번째 곡', 'number': 2}
        self.album['tracks'].append(second)
        def fail_second(track, *args):
            if track['number'] == 2: raise RuntimeError('simulated network failure')
            return self.source_fn()
        result = self.run_job(fail_second); self.assertEqual(result['status'], 'partial'); self.assertEqual(len(result['errors']), 1)
        result = self.run_job(); self.assertEqual(result['status'], 'done'); self.assertEqual(self.calls, 2)
        self.assertEqual(len(list(Path(result['path']).glob('*.mp3'))), 2)

    def test_paths_and_symlinks(self):
        self.assertNotIn('/', w.component('../../가수/곡'))
        with self.assertRaises(ValueError): w.safe_child(self.root, '..', 'escape')
        link = self.root / 'linked'; link.symlink_to(self.root)
        with self.assertRaises(ValueError): w.safe_child(self.root, 'linked', 'test')

    def test_remote_host_validation(self):
        self.assertTrue(w.cover_host('https://lh3.googleusercontent.com/image'))
        self.assertFalse(w.cover_host('https://googleusercontent.com.evil.invalid/image'))
        self.assertFalse(w.cover_host('http://127.0.0.1/image'))
        with self.assertRaises(ValueError): w.album_url('https://music.youtube.com.evil.invalid/browse/MPRE1')

    def test_library_scan_does_not_modify_files(self):
        result = self.run_job(); file = next(Path(result['path']).glob('*.mp3')); before = file.stat().st_mtime_ns
        albums = w.library(self.request['root']); self.assertEqual(len(albums), 1)
        self.assertTrue(albums[0]['cover'].startswith('data:image/jpeg;base64,')); self.assertEqual(before, file.stat().st_mtime_ns)

    def test_playlist_fallback_requires_exact_position_and_title(self):
        api = MagicMock()
        api.get_album.return_value = {'title': '시험', 'artists': [{'name': '가수'}], 'year': '2026',
            'audioPlaylistId': 'OLAK5uy_test', 'thumbnails': [],
            'tracks': [{'title': '같은 제목', 'videoId': None}, {'title': '다른 곡', 'videoId': None}]}
        ydl = MagicMock()
        ydl.__enter__.return_value.extract_info.return_value = {'entries': [
            {'title': '같은 제목', 'id': 'abcdefghijk'}, {'title': '비슷하지만 다른 곡', 'id': 'lmnopqrstuv'}]}
        with patch.object(w, 'YTMusic', return_value=api), patch.object(w.yt_dlp, 'YoutubeDL', return_value=ydl), patch.object(w, 'fetch_cover', return_value=self.cover):
            album = w.inspect_album('https://music.youtube.com/browse/MPRE_test')
        self.assertEqual(album['tracks'][0]['id'], 'abcdefghijk')
        self.assertTrue(album['tracks'][0]['available'])
        self.assertFalse(album['tracks'][1]['available'])
        self.assertEqual(album['tracks'][1]['id'], '')
        self.assertTrue(album['coverPreview'].startswith('data:image/jpeg;base64,'))

if __name__ == '__main__': unittest.main()
