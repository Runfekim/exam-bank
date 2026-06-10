#!/usr/bin/env python3
# 컬럼 이미지에 y축 눈금자(가로선 + y좌표 라벨)를 그려 크롭 좌표를 눈으로 정확히 읽게 한다.
# 사용: python3 tools/ruler.py <in.png> <out.png> [step]
import sys
from PIL import Image, ImageDraw, ImageFont

inp, outp = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 100

im = Image.open(inp).convert("RGB")
W, H = im.size
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 22)
except Exception:
    font = ImageFont.load_default()

for y in range(0, H, step):
    d.line([(0, y), (W, y)], fill=(255, 0, 0), width=1)
    label = str(y)
    # 좌/우 양쪽에 라벨(가독성)
    d.rectangle([0, y, 56, y + 24], fill=(255, 255, 0))
    d.text((2, y + 1), label, fill=(200, 0, 0), font=font)
    d.rectangle([W - 58, y, W, y + 24], fill=(255, 255, 0))
    d.text((W - 56, y + 1), label, fill=(200, 0, 0), font=font)

im.save(outp)
print(f"{outp}  ({W}x{H}, step={step})")
