#!/usr/bin/env node
/**
 * Regenerates public/og-card.png, the 1200x630 card that WhatsApp, Facebook,
 * X and iMessage show when a genaie.site link is shared.
 *
 * Runs on plain Node (zlib only) so it needs no install step. Re-run it with
 * `npm run generate:og-image` after changing the logo or the hero artwork.
 *
 * WhatsApp is the strictest consumer of this file: it drops thumbnails much
 * over ~600KB, so the encoder below palettises the card and the script fails
 * if the result would be too heavy to render.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const WIDTH = 1200;
const HEIGHT = 630;
/** WhatsApp starts dropping previews above roughly 600KB; stay well clear. */
const MAX_BYTES = 300 * 1024;

const BACKGROUND = [0xfa, 0xfa, 0xf8]; // --surface
const ACCENT = [0x47, 0x8f, 0x77]; // --accent
const INK = [0x05, 0x05, 0x05]; // --text-heading

/* -------------------------------------------------------------- decoding */

function readChunks(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) {
    throw new Error("not a PNG");
  }
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return chunks;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Reverses the per-scanline filters defined in the PNG spec, in place. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const target = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? target[x - bpp] : 0;
      const up = prior ? prior[x] : 0;
      const upLeft = prior && x >= bpp ? prior[x - bpp] : 0;
      const value = line[x];
      switch (filter) {
        case 0:
          target[x] = value;
          break;
        case 1:
          target[x] = (value + left) & 0xff;
          break;
        case 2:
          target[x] = (value + up) & 0xff;
          break;
        case 3:
          target[x] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          target[x] = (value + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unsupported filter ${filter}`);
      }
    }
  }
  return out;
}

/** Decodes a non-interlaced 8-bit RGB/RGBA PNG into a flat RGBA surface. */
function decodePng(path) {
  const chunks = readChunks(readFileSync(path));
  const header = chunks.find((chunk) => chunk.type === "IHDR");
  if (!header) throw new Error(`${path}: missing IHDR`);

  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const depth = header.data[8];
  const colorType = header.data[9];
  const interlace = header.data[12];

  if (depth !== 8) throw new Error(`${path}: only 8-bit PNGs are supported`);
  if (interlace !== 0) throw new Error(`${path}: interlaced PNGs are not supported`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`${path}: only RGB/RGBA PNGs are supported`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const idat = Buffer.concat(
    chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data),
  );
  const pixels = unfilter(inflateSync(idat), width, height, bpp);

  // Normalise to RGBA so the compositor only deals with one layout.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = pixels[i * bpp];
    rgba[i * 4 + 1] = pixels[i * bpp + 1];
    rgba[i * 4 + 2] = pixels[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? pixels[i * bpp + 3] : 0xff;
  }
  return { width, height, data: rgba };
}

/* ------------------------------------------------------------ compositing */

/**
 * Box-filter resample. The sources are much larger than their slots on the
 * card, so averaging every contributing source pixel keeps the thin pen
 * strokes of the line art from breaking up the way nearest-neighbour would.
 */
function resize(image, targetWidth, targetHeight) {
  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = image.width / targetWidth;
  const yRatio = image.height / targetHeight;

  for (let y = 0; y < targetHeight; y += 1) {
    const srcYStart = Math.floor(y * yRatio);
    const srcYEnd = Math.max(srcYStart + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcXStart = Math.floor(x * xRatio);
      const srcXEnd = Math.max(srcXStart + 1, Math.floor((x + 1) * xRatio));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      for (let sy = srcYStart; sy < srcYEnd && sy < image.height; sy += 1) {
        for (let sx = srcXStart; sx < srcXEnd && sx < image.width; sx += 1) {
          const i = (sy * image.width + sx) * 4;
          const alpha = image.data[i + 3];
          // Premultiply so transparent pixels cannot bleed their colour in.
          r += image.data[i] * alpha;
          g += image.data[i + 1] * alpha;
          b += image.data[i + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }

      const o = (y * targetWidth + x) * 4;
      if (a === 0 || count === 0) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
      } else {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
        out[o + 3] = Math.round(a / count);
      }
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}

function createCanvas(color) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    data[i * 3] = color[0];
    data[i * 3 + 1] = color[1];
    data[i * 3 + 2] = color[2];
  }
  return data;
}

function fillRect(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    if (row < 0 || row >= HEIGHT) continue;
    for (let col = x; col < x + width; col += 1) {
      if (col < 0 || col >= WIDTH) continue;
      const i = (row * WIDTH + col) * 3;
      canvas[i] = color[0];
      canvas[i + 1] = color[1];
      canvas[i + 2] = color[2];
    }
  }
}

/**
 * Draws an RGBA image over the opaque canvas.
 *
 * `tint` recolours the source: the artwork is black line work on a
 * transparent field, so its alpha is the only channel carrying shape and we
 * are free to substitute any ink colour.
 */
function drawImage(canvas, image, originX, originY, tint) {
  for (let y = 0; y < image.height; y += 1) {
    const targetY = originY + y;
    if (targetY < 0 || targetY >= HEIGHT) continue;
    for (let x = 0; x < image.width; x += 1) {
      const targetX = originX + x;
      if (targetX < 0 || targetX >= WIDTH) continue;

      const src = (y * image.width + x) * 4;
      const alpha = image.data[src + 3] / 255;
      if (alpha === 0) continue;

      const ink = tint ?? [image.data[src], image.data[src + 1], image.data[src + 2]];
      const dst = (targetY * WIDTH + targetX) * 3;
      canvas[dst] = Math.round(ink[0] * alpha + canvas[dst] * (1 - alpha));
      canvas[dst + 1] = Math.round(ink[1] * alpha + canvas[dst + 1] * (1 - alpha));
      canvas[dst + 2] = Math.round(ink[2] * alpha + canvas[dst + 2] * (1 - alpha));
    }
  }
}

/** Scales an image so it fits inside the given box without distortion. */
function fitWithin(image, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  return resize(image, Math.round(image.width * scale), Math.round(image.height * scale));
}

/* -------------------------------------------------------------- encoding */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encodes as an indexed-colour PNG. The card only contains the background,
 * the accent and antialiased greys between them, so a palette both stays
 * lossless in practice and roughly halves the file WhatsApp has to fetch.
 */
function encodeIndexedPng(canvas) {
  const lookup = new Map();
  const palette = [];
  const indexed = Buffer.alloc(WIDTH * HEIGHT);

  for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
    const r = canvas[i * 3];
    const g = canvas[i * 3 + 1];
    const b = canvas[i * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    let index = lookup.get(key);
    if (index === undefined) {
      if (palette.length >= 256) return null; // caller falls back to truecolour
      index = palette.length;
      palette.push([r, g, b]);
      lookup.set(key, index);
    }
    indexed[i] = index;
  }

  const raw = Buffer.alloc(HEIGHT * (WIDTH + 1));
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[y * (WIDTH + 1)] = 0; // filter: none
    indexed.copy(raw, y * (WIDTH + 1) + 1, y * WIDTH, (y + 1) * WIDTH);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach(([r, g, b], i) => {
    plte[i * 3] = r;
    plte[i * 3 + 1] = g;
    plte[i * 3 + 2] = b;
  });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function encodeTruecolourPng(canvas) {
  const stride = WIDTH * 3;
  const raw = Buffer.alloc(HEIGHT * (stride + 1));
  for (let y = 0; y < HEIGHT; y += 1) {
    raw[y * (stride + 1)] = 1; // filter: sub, cheap win on flat runs
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? canvas[y * stride + x - 3] : 0;
      raw[y * (stride + 1) + 1 + x] = (canvas[y * stride + x] - left) & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Snapping near-identical antialiasing greys onto a coarser ramp keeps the
 * palette under 256 entries without any visible banding on line art.
 */
function quantise(canvas, step) {
  for (let i = 0; i < canvas.length; i += 1) {
    canvas[i] = Math.min(255, Math.round(canvas[i] / step) * step);
  }
}

/* ------------------------------------------------------------------ card */

function build() {
  const canvas = createCanvas(BACKGROUND);

  // Accent rule along the bottom edge, echoing the site's buttons.
  fillRect(canvas, 0, HEIGHT - 12, WIDTH, 12, ACCENT);

  // Hero artwork on the right.
  const robot = fitWithin(decodePng(join(ROOT, "public", "Pasted image (3).png")), 560, 470);
  drawImage(canvas, robot, WIDTH - robot.width - 70, Math.round((HEIGHT - 12 - robot.height) / 2));

  // Wordmark on the left, optically centred against the artwork.
  const logo = fitWithin(decodePng(join(ROOT, "public", "logo.png")), 440, 200);
  const logoX = 90;
  const logoY = Math.round((HEIGHT - 12) / 2) - logo.height;
  drawImage(canvas, logo, logoX, logoY, INK);

  // Short accent bar under the wordmark, standing in for the tagline rule.
  fillRect(canvas, logoX + 4, logoY + logo.height + 44, 132, 10, ACCENT);

  quantise(canvas, 8);

  const png = encodeIndexedPng(canvas) ?? encodeTruecolourPng(canvas);
  if (png.length > MAX_BYTES) {
    throw new Error(
      `card is ${(png.length / 1024).toFixed(0)}KB, over the ${MAX_BYTES / 1024}KB budget ` +
        "that keeps WhatsApp previews reliable",
    );
  }

  const target = join(ROOT, "public", "og-card.png");
  writeFileSync(target, png);
  console.log(`wrote ${target} — ${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)}KB`);
}

build();
