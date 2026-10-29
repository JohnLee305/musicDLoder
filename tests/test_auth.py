import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
import album_worker as w
from yt_dlp.cookies import YoutubeDLCookieJar


class AuthTest(unittest.TestCase):
    def test_only_youtube_cookies_with_scope_and_flags(self):
        jar = YoutubeDLCookieJar()
        w.add_youtube_cookies(jar, [
            {'name': 'session', 'value': 'fake-secret', 'domain': '.youtube.com', 'path': '/', 'secure': True, 'httpOnly': True, 'expirationDate': 4102444800},
            {'name': 'foreign', 'value': 'never', 'domain': '.google.com'},
            {'name': 'lookalike', 'value': 'never', 'domain': 'youtube.com.evil.test'},
            {'name': 'bad', 'value': 'bad\nheader', 'domain': '.youtube.com'},
        ])
        self.assertEqual(len(jar), 1)
        self.assertIn('fake-secret', jar.get_cookie_header('https://www.youtube.com/watch'))
        self.assertIsNone(jar.get_cookie_header('https://example.com/'))
        self.assertIsNone(jar.get_cookie_header('http://www.youtube.com/'))
        c = next(iter(jar))
        self.assertTrue(c.has_nonstandard_attr('HttpOnly'))
        self.assertEqual(c.expires, 4102444800)
        self.assertIsNone(jar.filename)

    def test_download_cookie_jar_stays_in_memory_and_default_is_anonymous(self):
        for cookies in [None, [{'name': 'session', 'value': 'fake-secret', 'domain': '.youtube.com'}]]:
            with self.subTest(auth=bool(cookies)), tempfile.TemporaryDirectory() as temp:
                client = MagicMock()
                client.cookiejar = YoutubeDLCookieJar()
                client.__enter__.return_value = client
                client.prepare_filename.return_value = str(Path(temp) / 'source.webm')
                with patch.object(w.yt_dlp, 'YoutubeDL', return_value=client) as factory:
                    w.download_source({'id': 'abcdefghijk'}, Path(temp), None, lambda _: None, cookies=cookies)
                self.assertEqual(len(client.cookiejar), 1 if cookies else 0)
                opts = factory.call_args.args[0]
                self.assertNotIn('cookiefile', opts)
                self.assertNotIn('cookiesfrombrowser', opts)
                self.assertEqual(list(Path(temp).iterdir()), [])
