import lzma
import sys

# Decompresses stdin to stdout, the inverse of tools/xz-compress.py. Used by
# tools/verify-deb.mjs to prove that the .xz members inside the .deb are readable.
#
# LZMADecompressor is used instead of lzma.open() because a piped stdout is not seekable.
decompressor = lzma.LZMADecompressor(format=lzma.FORMAT_XZ)
out = sys.stdout.buffer
while True:
    chunk = sys.stdin.buffer.read(1 << 20)
    if not chunk:
        break
    block = decompressor.decompress(chunk)
    if block:
        out.write(block)
out.flush()
