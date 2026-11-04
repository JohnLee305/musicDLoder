"""Synthetic test albums; never reads the user's music collection."""
import sys
import subprocess
from pathlib import Path
from PIL import Image
import imageio_ffmpeg
root = Path(sys.argv[1])
for index, color in enumerate(['#60784a', '#b68e54'], 1):
    album = root / '테스트 가수' / f'테스트 앨범 {index}'
    album.mkdir(parents=True)
    Image.new('RGB', (240, 240), color).save(album / 'cover.jpg')
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.1', str(album / '01 테스트.mp3')], check=True)
