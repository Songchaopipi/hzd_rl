from pathlib import Path
from PIL import Image

for path in sorted(Path('tests/artifacts').glob('*-canvas-*.png')):
    image = Image.open(path).convert('RGB')
    assert image.width >= 300 and image.height >= 290, path
    dark = sum(max(pixel) < 150 for pixel in image.getdata())
    assert dark > 300, (path, 'blank or missing robot', dark)
    print(path.name, image.size, 'dark pixels:', dark)
