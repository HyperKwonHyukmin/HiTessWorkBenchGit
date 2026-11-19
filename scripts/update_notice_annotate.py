"""업데이트 안내 그림 — 원본 캡처를 자르고 주황 상자와 번호(①②…) 또는 글 이름표를 얹는다.

사용: python -X utf8 scripts/update_notice_annotate.py <spec.json>   (/update-notice 명령이 쓴다)
spec.json = [{"src": 원본, "out": 결과, "crop": [l,t,r,b] | null, "scale": 1.0,
              "marks": [{"box": [l,t,r,b], "n": 1, "label": "글(선택)", "at": "below|above|left|right"}]}]
box 좌표는 원본 기준(자르기 전). 색과 굵기는 기존 안내 그림(mf-*.png)과 같게 맞췄다.
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

ORANGE = (245, 166, 35)
DARK = (20, 22, 34)
FONT_BOLD = "C:/Windows/Fonts/malgunbd.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT_BOLD, size)
    except OSError:
        return ImageFont.load_default()


def badge(draw, cx, cy, n, r):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE, outline=DARK, width=max(2, r // 6))
    f = font(int(r * 1.3))
    t = str(n)
    w = draw.textlength(t, font=f)
    draw.text((cx - w / 2, cy - r * 0.78), t, fill=DARK, font=f)


def label(draw, x, y, text, size, anchor_right=False):
    f = font(size)
    w = draw.textlength(text, font=f)
    pad = size * 0.45
    x0 = x - w - 2 * pad if anchor_right else x
    draw.rounded_rectangle([x0, y, x0 + w + 2 * pad, y + size * 1.55], radius=size * 0.3, fill=ORANGE)
    draw.text((x0 + pad, y + size * 0.12), text, fill=DARK, font=f)


def run(item):
    im = Image.open(item["src"]).convert("RGB")
    ox, oy = 0, 0
    if item.get("crop"):
        l, t, r, b = item["crop"]
        im = im.crop((l, t, r, b))
        ox, oy = l, t
    s = float(item.get("scale", 1.0))
    if s != 1.0:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    lw = max(3, round(3 * s))
    r = max(13, round(13 * s))
    for m in item.get("marks", []):
        l, t, rr, b = [(v - o) * s for v, o in zip(m["box"], (ox, oy, ox, oy))]
        d.rounded_rectangle([l, t, rr, b], radius=6 * s, outline=ORANGE, width=lw)
        if m.get("n") is not None:
            # 번호는 상자 왼쪽 위 모서리에(그림 밖으로 나가지 않게 안쪽으로 당김)
            cx = min(max(l, r + 2), im.width - r - 2)
            cy = min(max(t, r + 2), im.height - r - 2)
            badge(d, cx, cy, m["n"], r)
        if m.get("label"):
            size = round(15 * s)
            at = m.get("at", "below")
            if at == "below":
                label(d, l, b + 6 * s, m["label"], size)
            elif at == "above":
                label(d, l, t - size * 1.55 - 6 * s, m["label"], size)
            elif at == "right":
                label(d, rr + 8 * s, t, m["label"], size)
            else:
                label(d, l - 8 * s, t, m["label"], size, anchor_right=True)
    im.save(item["out"], optimize=True)
    print("wrote", item["out"], im.size)


if __name__ == "__main__":
    for it in json.load(open(sys.argv[1], encoding="utf-8")):
        run(it)
