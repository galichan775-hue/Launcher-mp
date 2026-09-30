import lzma
import sys

# Compresses stdin to stdout as .xz. Used by tools/build-deb.mjs because Windows has no
# xz compressor: libarchive's bsdtar cannot compress an already-built tar stream, and
# fpm only exists inside the electron-builder Linux Docker image.
#
# LZMACompressor is used instead of lzma.open() because the latter needs a seekable output
# file, and a piped stdout is not seekable.
preset = int(sys.argv[1]) if len(sys.argv) > 1 else 6
compressor = lzma.LZMACompressor(
    format=lzma.FORMAT_XZ,
    check=lzma.CHECK_CRC64,
    filters=[{"id": lzma.FILTER_LZMA2, "preset": preset}],
)
out = sys.stdout.buffer
while True:
    chunk = sys.stdin.buffer.read(1 << 20)
    if not chunk:
        break
    block = compressor.compress(chunk)
    if block:
        out.write(block)
out.write(compressor.flush())
out.flush()
