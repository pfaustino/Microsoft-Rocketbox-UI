// Uncompressed and RLE truecolor TGA, the formats used by Rocketbox textures.

export function decodeTga(buf) {
  if (buf.length < 18) throw new Error('TGA header is truncated');
  const idLen = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2];
  const width = buf.readUInt16LE(12);
  const height = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  if (width === 0 || height === 0) throw new Error('TGA has no pixels');
  if (bpp !== 24 && bpp !== 32) throw new Error(`Unsupported TGA depth ${bpp}`);
  if (imageType !== 2 && imageType !== 10) throw new Error(`Unsupported TGA type ${imageType}`);

  let offset = 18 + idLen;
  if (colorMapType !== 0) {
    const cmLen = buf.readUInt16LE(5);
    const cmBits = buf[7];
    offset += cmLen * Math.ceil(cmBits / 8);
  }

  const bytesPer = bpp / 8;
  const pixelCount = width * height;
  const raw = imageType === 2
    ? buf.subarray(offset, offset + pixelCount * bytesPer)
    : decodeRle(buf.subarray(offset), pixelCount, bytesPer);
  if (raw.length < pixelCount * bytesPer) throw new Error('TGA pixel data is truncated');

  const straight = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    const s = i * bytesPer;
    straight[i * 4] = raw[s + 2];
    straight[i * 4 + 1] = raw[s + 1];
    straight[i * 4 + 2] = raw[s];
    straight[i * 4 + 3] = bytesPer === 4 ? raw[s + 3] : 255;
  }

  let pixels = straight;
  if ((desc & 0x10) !== 0) pixels = flipHorizontal(pixels, width, height);
  if ((desc & 0x20) === 0) pixels = flipVertical(pixels, width, height);
  return { width, height, pixels };
}

export async function tgaToPng(buf, maxEdge) {
  const { PNG } = await import('pngjs');
  const image = downscale(decodeTga(buf), maxEdge);
  const png = new PNG({ width: image.width, height: image.height });
  image.pixels.copy(png.data);
  return PNG.sync.write(png);
}

function decodeRle(raw, pixelCount, bytesPer) {
  const out = Buffer.alloc(pixelCount * bytesPer);
  let di = 0;
  let si = 0;
  while (di < out.length) {
    if (si >= raw.length) break;
    const header = raw[si++];
    const count = (header & 0x7f) + 1;
    if (header & 0x80) {
      if (si + bytesPer > raw.length) break;
      const px = raw.subarray(si, si + bytesPer);
      si += bytesPer;
      for (let i = 0; i < count && di < out.length; i++) {
        px.copy(out, di);
        di += bytesPer;
      }
    } else {
      const n = count * bytesPer;
      if (si + n > raw.length) break;
      raw.copy(out, di, si, si + n);
      si += n;
      di += n;
    }
  }
  return out;
}

function flipVertical(pixels, width, height) {
  const row = width * 4;
  const out = Buffer.alloc(pixels.length);
  for (let y = 0; y < height; y++) {
    pixels.copy(out, (height - 1 - y) * row, y * row, (y + 1) * row);
  }
  return out;
}

function flipHorizontal(pixels, width, height) {
  const out = Buffer.alloc(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = (y * width + (width - 1 - x)) * 4;
      pixels.copy(out, d, s, s + 4);
    }
  }
  return out;
}

function downscale(image, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const dst = Buffer.alloc(width * height * 4);
  const xr = image.width / width;
  const yr = image.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * yr);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * yr)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * xr);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * xr)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * image.width + xx) * 4;
          r += image.pixels[i];
          g += image.pixels[i + 1];
          b += image.pixels[i + 2];
          a += image.pixels[i + 3];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = Math.round(a / n);
    }
  }
  return { width, height, pixels: dst };
}
