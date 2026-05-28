#!/usr/bin/env python3
"""Generate flat gradient PNG icons for the PWA.

Pure standard library — no Pillow / cairo / rsvg required.
Produces icon-192.png, icon-512.png, icon-maskable.png in web/.
"""
import os
import struct
import zlib

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: str, width: int, height: int, rgba: bytes) -> None:
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter: None
        raw.extend(rgba[y * stride:(y + 1) * stride])
    idat = zlib.compress(bytes(raw), 9)
    with open(path, 'wb') as f:
        f.write(sig)
        f.write(png_chunk(b'IHDR', ihdr))
        f.write(png_chunk(b'IDAT', idat))
        f.write(png_chunk(b'IEND', b''))


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def gradient_rgba(size: int, c1=(6, 35, 26), c2=(16, 185, 129), accent=(56, 189, 248)) -> bytes:
    out = bytearray(size * size * 4)
    cx, cy = size / 2.0, size / 2.0
    r_max = (cx * cx + cy * cy) ** 0.5
    for y in range(size):
        for x in range(size):
            t = ((x + y) / (2.0 * (size - 1)))
            r = lerp(c1[0], c2[0], t)
            g = lerp(c1[1], c2[1], t)
            b = lerp(c1[2], c2[2], t)
            dx = x - size * 0.32
            dy = y - size * 0.28
            d = (dx * dx + dy * dy) ** 0.5 / r_max
            glow = max(0.0, 1.0 - d * 1.6) * 0.45
            r = min(255, int(r + (accent[0] - r) * glow))
            g = min(255, int(g + (accent[1] - g) * glow))
            b = min(255, int(b + (accent[2] - b) * glow))
            i = (y * size + x) * 4
            out[i] = r
            out[i + 1] = g
            out[i + 2] = b
            out[i + 3] = 255
    return bytes(out)


def main() -> None:
    os.makedirs(WEB_DIR, exist_ok=True)
    for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (512, 'icon-maskable.png')]:
        path = os.path.join(WEB_DIR, name)
        rgba = gradient_rgba(size)
        write_png(path, size, size, rgba)
        print(f'Wrote {path} ({size}x{size})')


if __name__ == '__main__':
    main()
