#!/usr/bin/env python3
"""Draw the original Tab Noise Tracker icons.

Stdlib only. Run from the repo root: python3 tools/draw_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "icons"


def write_png(path, width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def put(buf, size, x, y, color):
    if x < 0 or y < 0 or x >= size or y >= size:
        return
    red, green, blue, alpha = color
    index = (y * size + x) * 4
    src_a = alpha / 255
    dst_a = buf[index + 3] / 255
    out_a = src_a + dst_a * (1 - src_a)
    if out_a <= 0:
        return
    for channel, src in enumerate((red, green, blue)):
        dst = buf[index + channel]
        buf[index + channel] = int(round((src * src_a + dst * dst_a * (1 - src_a)) / out_a))
    buf[index + 3] = int(round(out_a * 255))


def fill_rounded_rect(buf, size, x, y, width, height, radius, color):
    rad = min(radius, width / 2, height / 2)
    for py in range(int(y), int(math.ceil(y + height))):
        for px in range(int(x), int(math.ceil(x + width))):
            cx = px + 0.5
            cy = py + 0.5
            dx = 0
            dy = 0
            if cx < x + rad:
                dx = x + rad - cx
            elif cx > x + width - rad:
                dx = cx - (x + width - rad)
            if cy < y + rad:
                dy = y + rad - cy
            elif cy > y + height - rad:
                dy = cy - (y + height - rad)
            if dx * dx + dy * dy <= rad * rad:
                put(buf, size, px, py, color)


def fill_polygon(buf, size, points, color):
    ys = [point[1] for point in points]
    y_start, y_end = int(min(ys)), int(max(ys))
    for y in range(y_start, y_end + 1):
        scan = y + 0.5
        crossings = []
        for index, (x1, y1) in enumerate(points):
            x2, y2 = points[(index + 1) % len(points)]
            if (y1 <= scan < y2) or (y2 <= scan < y1):
                crossings.append(x1 + (scan - y1) * (x2 - x1) / (y2 - y1))
        crossings.sort()
        for index in range(0, len(crossings) - 1, 2):
            left = int(crossings[index])
            right = int(math.ceil(crossings[index + 1]))
            for x in range(left, right):
                put(buf, size, x, y, color)


def angle_between(angle, start, end):
    def wrap(value):
        while value <= -math.pi:
            value += 2 * math.pi
        while value > math.pi:
            value -= 2 * math.pi
        return value

    angle, start, end = wrap(angle), wrap(start), wrap(end)
    if start <= end:
        return start <= angle <= end
    return angle >= start or angle <= end


def stroke_arc(buf, size, cx, cy, radius, width, start, end, color):
    pad = int(width) + 2
    for y in range(int(cy - radius - pad), int(cy + radius + pad) + 1):
        for x in range(int(cx - radius - pad), int(cx + radius + pad) + 1):
            dx = x + 0.5 - cx
            dy = y + 0.5 - cy
            if abs(math.hypot(dx, dy) - radius) > width / 2:
                continue
            if angle_between(math.atan2(dy, dx), start, end):
                put(buf, size, x, y, color)


def downsample(src, src_size, scale):
    dst = src_size // scale
    out = bytearray(dst * dst * 4)
    for y in range(dst):
        for x in range(dst):
            totals = [0, 0, 0, 0]
            for oy in range(scale):
                for ox in range(scale):
                    index = ((y * scale + oy) * src_size + (x * scale + ox)) * 4
                    for channel in range(4):
                        totals[channel] += src[index + channel]
            samples = scale * scale
            offset = (y * dst + x) * 4
            for channel in range(4):
                out[offset + channel] = totals[channel] // samples
    return out


def draw(size, background, foreground, wave):
    scale = 4
    pixels = size * scale
    buf = bytearray(pixels * pixels * 4)

    def unit(value):
        return value * scale * size / 128

    fill_rounded_rect(buf, pixels, unit(6), unit(6), unit(116), unit(116), unit(28), background)
    fill_rounded_rect(buf, pixels, unit(30), unit(50), unit(20), unit(28), unit(4), foreground)
    fill_polygon(buf, pixels, [
        (unit(48), unit(50)),
        (unit(78), unit(32)),
        (unit(78), unit(96)),
        (unit(48), unit(78)),
    ], foreground)
    stroke_arc(buf, pixels, unit(78), unit(64), unit(18), unit(7), -0.95, 0.95, wave)
    stroke_arc(buf, pixels, unit(78), unit(64), unit(30), unit(7), -0.8, 0.8, wave)
    return downsample(buf, pixels, scale)


def main():
    ROOT.mkdir(parents=True, exist_ok=True)
    navy = (18, 50, 74, 255)
    cream = (255, 250, 240, 255)
    amber = (224, 137, 0, 255)
    ink = (27, 20, 4, 255)
    for size in (16, 32, 48, 128):
        write_png(ROOT / f"icon{size}.png", size, size, draw(size, navy, cream, amber))
        write_png(ROOT / f"alert{size}.png", size, size, draw(size, amber, ink, ink))
    print(f"Wrote icons to {ROOT}")


if __name__ == "__main__":
    main()
