import glob
import os
import sys

from PIL import Image, ImageDraw

if len(sys.argv) != 3:
    sys.exit('usage: contact-sheet.py <dir-with-webp> <out-prefix>')

src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, '*.webp')))
W, H, COLS, PER_PAGE = 480, 330, 4, 16

for start in range(0, len(files), PER_PAGE):
    part = files[start:start + PER_PAGE]
    rows = (len(part) + COLS - 1) // COLS
    sheet = Image.new('RGB', (W * COLS, H * rows), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, f in enumerate(part):
        im = Image.open(f).convert('RGB')
        im.thumbnail((W - 8, H - 24))
        x, y = (i % COLS) * W + 4, (i // COLS) * H + 18
        sheet.paste(im, (x, y))
        draw.text((x, y - 14), os.path.basename(f), fill='blue')
    sheet.save(f'{out}-{start // PER_PAGE}.png')
    print(f'{out}-{start // PER_PAGE}.png')
