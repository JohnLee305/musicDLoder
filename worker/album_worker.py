"""Line-delimited JSON worker. Only accepts opt-in YouTube cookies in memory; never modifies source music."""
import base64
from http.cookiejar import Cookie
from functools import partial
import hashlib
import io
import json
import os
import re
import shutil
import signal
import ssl
import subprocess
import sys
import tempfile
import traceback
import unicodedata
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import imageio_ffmpeg
import requests
from PIL import Image, ImageOps
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TPE2, TALB, TRCK, TPOS, TDRC, TCMP
from mutagen.mp3 import MP3
from ytmusicapi import YTMusic
import yt_dlp


def emit(kind, **data):
    print(json.dumps({'type': kind, **data}, ensure_ascii=False), flush=True)


def component(text):
    text = unicodedata.normalize('NFC', str(text))
    text = re.sub(r'[\x00-\x1f\x7f/\\:*?"<>|]', '_', text).strip(' .')
    return (text[:100].rstrip(' .') or '이름 없음')


def safe_child(root, *parts):
    root = Path(root).resolve()
    candidate = root.joinpath(*parts)
    if not candidate.resolve().is_relative_to(root):
        raise ValueError('저장 폴더 밖으로 나가는 경로는 사용할 수 없습니다.')
    # Existing symlinks must not redirect output, even within the library.
    cursor = candidate
    while cursor != root:
        if cursor.is_symlink():
            raise ValueError('심볼릭 링크 폴더에는 저장하지 않습니다.')
        cursor = cursor.parent
    return candidate


def album_url(url):
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.hostname != 'music.youtube.com':
        raise ValueError('YT Music의 앨범 페이지를 열어 주세요.')
    return parsed


def inspect_album(url):
    parsed = album_url(url)
    # The API parser's stable labels are English; track names remain the service's originals.
    api = YTMusic(language='en')
    browse = parsed.path.removeprefix('/browse/') if parsed.path.startswith('/browse/') else None
    if not browse:
        playlist = parse_qs(parsed.query).get('list', [''])[0]
        if not playlist.startswith('OLAK5uy_'):
            raise ValueError('앨범 페이지에서 담아 주세요. 일반 재생목록과 라디오는 아직 지원하지 않습니다.')
        browse = api.get_album_browse_id(playlist)
    if not browse or not browse.startswith('MPRE'):
        raise ValueError('앨범을 찾지 못했습니다. 앨범 상세 페이지를 열어 주세요.')
    data = api.get_album(browse)
    items = data.get('tracks', [])
    if any(not item.get('videoId') for item in items) and data.get('audioPlaylistId'):
        # Public YouTube album playlists may expose track IDs omitted by the Music API.
        # Match exact titles and positions only; never substitute a similarly named video.
        try:
            opts = {'extract_flat': 'in_playlist', 'skip_download': True, 'quiet': True,
                    'logger': QuietLogger(), 'socket_timeout': 20, 'retries': 1}
            with yt_dlp.YoutubeDL(opts) as ydl:
                listing = ydl.extract_info('https://www.youtube.com/playlist?list=' + data['audioPlaylistId'], download=False)
            entries = list(listing.get('entries', []))
            normalize = lambda name: ' '.join(unicodedata.normalize('NFC', name or '').casefold().split())
            if len(entries) == len(items):
                for item, entry in zip(items, entries):
                    if entry and not item.get('videoId') and normalize(item.get('title')) == normalize(entry.get('title')) and entry.get('availability') not in ('private', 'premium_only', 'subscriber_only', 'needs_auth'):
                        item['videoId'] = entry.get('id')
                        item['isAvailable'] = bool(entry.get('id'))
        except Exception:
            pass  # Keep unavailable tracks explicit in the preview.
    artist = ', '.join(x['name'] for x in data.get('artists', [])) or '알 수 없는 아티스트'
    thumbnails = data.get('thumbnails', [])
    cover = max(thumbnails, key=lambda x: x.get('width', 0))['url'] if thumbnails else ''
    tracks = []
    for index, item in enumerate(data.get('tracks', []), 1):
        tracks.append({'id': item.get('videoId') or '', 'title': item.get('title') or f'Track {index}',
                       'artist': ', '.join(x['name'] for x in item.get('artists', [])) or artist,
                       'number': index, 'disc': 1, 'duration': item.get('duration', ''),
                       'available': bool(item.get('videoId')) and item.get('isAvailable', True)})
    if not tracks:
        raise ValueError('앨범에 수록곡이 없습니다.')
    preview = ''
    try:
        preview = 'data:image/jpeg;base64,' + base64.b64encode(fetch_cover(cover)).decode()
    except Exception:
        pass
    return {'id': browse, 'url': f'https://music.youtube.com/browse/{browse}', 'coverPreview': preview,
            'title': data.get('title', '제목 없음'), 'artist': artist, 'year': str(data.get('year') or ''),
            'cover': cover, 'tracks': tracks, 'compilation': False}


def cover_host(url):
    parsed = urlparse(url)
    host = parsed.hostname or ''
    return parsed.scheme == 'https' and any(host == d or host.endswith('.' + d)
                                           for d in ('googleusercontent.com', 'ytimg.com', 'ggpht.com'))


def fetch_cover(url):
    if not url:
        raise ValueError('커버 이미지가 없는 앨범입니다.')
    for _ in range(4):
        if not cover_host(url):
            raise ValueError('허용되지 않은 커버 주소입니다.')
        with requests.get(url, timeout=25, stream=True, allow_redirects=False) as response:
            if response.is_redirect:
                url = response.headers.get('Location', '')
                continue
            response.raise_for_status()
            contents = bytearray()
            for block in response.iter_content(65536):
                contents.extend(block)
                if len(contents) > 20_000_000:
                    raise ValueError('커버 이미지가 너무 큽니다.')
            with Image.open(io.BytesIO(contents)) as image:
                image = ImageOps.exif_transpose(image).convert('RGB')
                image.thumbnail((600, 600), Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, format='JPEG', quality=90)
                return output.getvalue()
    raise ValueError('커버 주소를 확인할 수 없습니다.')


def encode_track(source, target, album, track, cover, bitrate):
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    result = subprocess.run([ffmpeg, '-nostdin', '-hide_banner', '-loglevel', 'error', '-n',
                             '-i', str(source), '-map', '0:a:0', '-vn', '-map_metadata', '-1',
                             '-c:a', 'libmp3lame', '-b:a', f'{bitrate}k', '-ar', '44100', '-ac', '2',
                             str(target)], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('MP3 변환 실패: ' + result.stderr[-700:])
    tags = ID3()
    tags.add(TIT2(encoding=1, text=track['title']))
    tags.add(TPE1(encoding=1, text=track['artist']))
    tags.add(TPE2(encoding=1, text=album['artist']))
    tags.add(TALB(encoding=1, text=album['title']))
    tags.add(TRCK(encoding=1, text=f"{track['number']}/{len(album['tracks'])}"))
    tags.add(TPOS(encoding=1, text=str(track.get('disc', 1))))
    if album.get('year'):
        tags.add(TDRC(encoding=1, text=album['year']))
    tags.add(TCMP(encoding=1, text='1' if album.get('compilation') else '0'))
    tags.add(APIC(encoding=0, mime='image/jpeg', type=3, desc='Cover', data=cover))
    tags.save(target, v2_version=3)
    info = MP3(target)
    if info.info.length <= 0 or not info.tags.getall('APIC'):
        raise RuntimeError('생성된 MP3 또는 커버를 검증하지 못했습니다.')


class QuietLogger:
    def debug(self, message): pass
    def info(self, message): pass
    def warning(self, message): pass
    def error(self, message): pass


def add_youtube_cookies(jar, cookies):
    for item in cookies:
        domain = item.get('domain', '')
        host = domain.lstrip('.')
        if host != 'youtube.com' and not host.endswith('.youtube.com'):
            continue
        name, value = item.get('name', ''), item.get('value', '')
        if not name or any(c in name + value + domain for c in '\r\n\x00'):
            continue
        expires = item.get('expirationDate')
        jar.set_cookie(Cookie(
            version=0, name=name, value=value, port=None, port_specified=False,
            domain=domain, domain_specified=not item.get('hostOnly', not domain.startswith('.')),
            domain_initial_dot=domain.startswith('.'), path=item.get('path') or '/',
            path_specified=True, secure=bool(item.get('secure')), expires=int(expires) if expires else None,
            discard=expires is None, comment=None, comment_url=None,
            rest={'HttpOnly': None} if item.get('httpOnly') else {}, rfc2109=False))


def download_source(track, stage, node, progress, cookies=None):
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', track['id']):
        raise ValueError('잘못된 곡 ID입니다.')
    opts = {'format': 'bestaudio/best', 'noplaylist': True, 'quiet': True,
            'logger': QuietLogger(), 'socket_timeout': 25, 'retries': 2,
            'outtmpl': str(stage / 'source.%(ext)s'), 'progress_hooks': [progress],
            'ffmpeg_location': imageio_ffmpeg.get_ffmpeg_exe(),
            'js_runtimes': {'node': {'path': node}} if node else {}}
    with yt_dlp.YoutubeDL(opts) as ydl:
        add_youtube_cookies(ydl.cookiejar, cookies or [])
        info = ydl.extract_info('https://www.youtube.com/watch?v=' + track['id'], download=True)
        return Path(ydl.prepare_filename(info))


def atomic_json(path, value):
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, prefix='.albumdock-', suffix='.tmp', delete=False) as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        tmp = Path(handle.name)
    tmp.replace(path)


def read_manifest(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def download_album(request, downloader=download_source, cover_loader=fetch_cover):
    if downloader is download_source:
        downloader = partial(download_source, cookies=request.get('cookies', []))
    album, root = request['album'], Path(request['root']).resolve()
    bitrate = request.get('bitrate', 256)
    if bitrate not in (192, 256, 320):
        raise ValueError('지원하지 않는 MP3 설정입니다.')
    root.mkdir(parents=True, exist_ok=True)
    artist_path = safe_child(root, component(album['artist']))
    artist_path.mkdir(exist_ok=True)
    base = component(album['title'])
    fingerprint = hashlib.sha256(album['id'].encode()).hexdigest()[:8]
    destination = safe_child(root, artist_path.name, base)
    # Never silently merge an unmanaged existing album into a new download.
    for suffix in range(100):
        name = base if suffix == 0 else f'{base} [{fingerprint}{"-" + str(suffix) if suffix > 1 else ""}]'
        destination = safe_child(root, artist_path.name, name)
        if not destination.exists():
            destination.mkdir()
            break
        if read_manifest(destination / '.albumdock.json').get('id') == album['id']:
            break
    else:
        raise ValueError('안전한 앨범 저장 위치를 만들지 못했습니다.')
    manifest_path = safe_child(root, destination.relative_to(root), '.albumdock.json')
    manifest = read_manifest(manifest_path)
    manifest.update(id=album['id'], title=album['title'], artist=album['artist'])
    manifest.setdefault('files', {})
    emit('progress', progress=0, message='앨범 커버 준비 중')
    cover = cover_loader(album['cover'])
    cover_path = safe_child(root, destination.relative_to(root), 'cover.jpg')
    if not cover_path.exists():
        with open(cover_path, 'xb') as handle:
            handle.write(cover)
    atomic_json(manifest_path, manifest)
    errors = []
    work = safe_child(root, '.albumdock-work')
    work.mkdir(exist_ok=True)
    for index, track in enumerate(album['tracks']):
        key = f"{track.get('disc', 1)}:{track['number']}:{track['id']}"
        existing = manifest['files'].get(key)
        if existing:
            old_path = safe_child(root, destination.relative_to(root), existing)
            try:
                if MP3(old_path).info.length > 0:
                    emit('progress', progress=(index + 1) / len(album['tracks']), message=f"이미 저장됨 · {track['title']}")
                    continue
            except Exception:
                pass
        if not track.get('available'):
            errors.append(f"{track['title']}: 제공되지 않는 곡")
            continue
        try:
            with tempfile.TemporaryDirectory(prefix='track-', dir=work) as temp:
                stage = Path(temp)
                def progress(info):
                    total = info.get('total_bytes') or info.get('total_bytes_estimate') or 1
                    ratio = min(0.9, info.get('downloaded_bytes', 0) / total * 0.9)
                    emit('progress', progress=(index + ratio) / len(album['tracks']), message=f"{index + 1}/{len(album['tracks'])} · {track['title']}")
                source = downloader(track, stage, request.get('node'), progress)
                emit('progress', progress=(index + .92) / len(album['tracks']), message=f"MP3 변환 · {track['title']}")
                result = stage / 'result.mp3'
                encode_track(source, result, album, track, cover, bitrate)
                disc = f"{track.get('disc', 1)}-" if any(t.get('disc', 1) > 1 for t in album['tracks']) else ''
                stem = f"{disc}{track['number']:02d} {component(track['title'])}"
                for attempt in range(100):
                    filename = stem + (f' ({attempt + 1})' if attempt else '') + '.mp3'
                    final = safe_child(root, destination.relative_to(root), filename)
                    try:
                        os.link(result, final)  # Same filesystem; atomic and refuses overwrites.
                        break
                    except FileExistsError:
                        continue
                else:
                    raise ValueError('동일한 파일명이 너무 많습니다.')
                manifest['files'][key] = filename
                atomic_json(manifest_path, manifest)
        except Exception as error:
            message = str(error)
            if 'confirm your age' in message.lower() or 'age-restricted' in message.lower():
                message = '연령 확인이 필요한 곡입니다. 앱에서 이 곡이 재생되는 계정으로 로그인하고, 설정의 YouTube 로그인 사용을 켠 뒤 다시 시도해 주세요.'
            elif request.get('cookies'):
                message = '로그인을 사용한 다운로드에 실패했습니다. 앱에서 곡 재생과 로그인 상태를 확인한 뒤 다시 시도해 주세요.'
            errors.append(f"{track['title']}: {message[-700:]}")
        emit('progress', progress=(index + 1) / len(album['tracks']), message=f"{index + 1}/{len(album['tracks'])}곡 처리")
    return {'path': str(destination), 'errors': errors,
            'status': 'partial' if errors and manifest['files'] else 'failed' if errors else 'done'}


def library(root):
    root = Path(root)
    if not root.is_dir():
        return []
    result = []
    for artist in sorted(root.iterdir()):
        if artist.name.startswith('.') or not artist.is_dir() or artist.is_symlink(): continue
        for album in sorted(artist.iterdir()):
            if album.name.startswith('.') or not album.is_dir() or album.is_symlink(): continue
            files = list(album.iterdir())
            songs = [f for f in files if f.suffix.lower() in ('.mp3', '.m4a', '.flac', '.wav', '.aac') and not f.is_symlink()]
            if not songs: continue
            images = sorted((f for f in files if f.suffix.lower() in ('.jpg', '.jpeg', '.png') and not f.is_symlink()), key=lambda f: not f.name.lower().startswith('cover'))
            cover = ''
            if images:
                try:
                    with Image.open(images[0]) as im:
                        im = im.convert('RGB'); im.thumbnail((240, 240))
                        buffer = io.BytesIO(); im.save(buffer, 'JPEG', quality=80)
                        cover = 'data:image/jpeg;base64,' + base64.b64encode(buffer.getvalue()).decode()
                except Exception: pass
            result.append({'title': unicodedata.normalize('NFC', album.name), 'artist': unicodedata.normalize('NFC', artist.name), 'path': str(album), 'count': len(songs), 'cover': cover})
    return result


def main():
    request = json.loads(sys.stdin.readline())
    if request['command'] == 'inspect':
        result = inspect_album(request['url'])
    elif request['command'] == 'download':
        result = download_album(request)
    elif request['command'] == 'library':
        result = library(request['root'])
    elif request['command'] == 'health':
        # Exercise the frozen TLS runtime too: missing policy files otherwise
        # remain invisible until the first network request.
        tls = ssl.create_default_context()
        result = {'yt_dlp': yt_dlp.version.__version__, 'ffmpeg': imageio_ffmpeg.get_ffmpeg_version(),
                  'tls_verified': tls.check_hostname and tls.verify_mode == ssl.CERT_REQUIRED}
    else:
        raise ValueError('알 수 없는 작업입니다.')
    emit('result', result=result)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit('error', message=str(error))
        sys.exit(1)
