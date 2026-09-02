/**
 * One-off favicon generator. Run with: `node scripts/generate-favicons.mjs`
 *
 * Rasterises the exact favicon mark in `public/permamind-favicon-source.png`
 * into the PNG sizes the browser,
 * iOS, Android, and Windows expect, and emits them to `public/`.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(process.cwd(), "public");
const SOURCE = path.join(ROOT, "permamind-favicon-source.png");
const SOURCE_LARGE = path.join(ROOT, "permamind-logo.png");

const TARGETS = [
  { name: "favicon-16x16.png", size: 16, padding: 0.1 },
  { name: "favicon-32x32.png", size: 32, padding: 0.1 },
  { name: "permamind-favicon.png", size: 512, padding: 0.12 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "android-chrome-192x192.png", size: 192 },
  { name: "android-chrome-512x512.png", size: 512 },
  { name: "mstile-150x150.png", size: 150 },
];

/**
 * Renders the source logo into a flat square PNG. We pad the canvas so the
 * logo has breathing room and remains legible at small sizes.
 */
async function rasterise(source, { name, size, padding = 0.08 }) {
  // The supplied PNGs include transparent export space. Removing only that
  // space makes the favicon mark readable without changing its artwork.
  const trimmed = await sharp(source)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const inset = Math.round(size * padding);
  const inner = size - inset * 2;

  const buffer = await sharp(trimmed)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  if (inset === 0) {
    return buffer;
  }

  // Composite onto a transparent canvas with padding.
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: buffer, gravity: "center" }])
    .png()
    .toBuffer();
}

/**
 * Multi-resolution .ico file. Browsers expect at least 16 and 32.
 */
async function buildIco() {
  const sizes = [16, 32, 48];
  const images = await Promise.all(
    sizes.map(async (size) => {
      // No padding at icon sizes — the mark must fill the frame so it
      // stays legible in a browser tab.
      const png = await rasterise(SOURCE, { name: `ico-${size}.png`, size, padding: 0 });
      return { size, png };
    }),
  );

  // Build a Windows ICO container manually since `sharp` does not emit one.
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dataOffset = headerSize + dirEntrySize * count;

  let totalSize = dataOffset;
  for (const { png } of images) totalSize += png.length;

  const buf = Buffer.alloc(totalSize);
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type 1 = .ico
  buf.writeUInt16LE(count, 4);

  let cursor = dataOffset;
  images.forEach((img, i) => {
    const offset = headerSize + i * dirEntrySize;
    buf.writeUInt8(img.size === 256 ? 0 : img.size, offset + 0);
    buf.writeUInt8(img.size === 256 ? 0 : img.size, offset + 1);
    buf.writeUInt8(0, offset + 2); // colour palette
    buf.writeUInt8(0, offset + 3); // reserved
    buf.writeUInt16LE(1, offset + 4); // colour planes
    buf.writeUInt16LE(32, offset + 6); // bpp
    buf.writeUInt32LE(img.png.length, offset + 8);
    buf.writeUInt32LE(cursor, offset + 12);
    img.png.copy(buf, cursor);
    cursor += img.png.length;
  });

  return buf;
}

async function main() {
  console.log(`> Generating favicons from ${path.relative(process.cwd(), SOURCE)}`);

  for (const target of TARGETS) {
    const buffer = await rasterise(SOURCE, target);
    const out = path.join(ROOT, target.name);
    await fs.writeFile(out, buffer);
    console.log(`  + ${target.name} (${target.size}x${target.size})`);
  }

  const ico = await buildIco();
  await fs.writeFile(path.join(ROOT, "favicon.ico"), ico);
  console.log("  + favicon.ico (16/32/48)");

  // Also rasterise a square OG-friendly PNG for richer social previews.
  const og = await rasterise(SOURCE_LARGE, { name: "og-image.png", size: 1200, padding: 0.1 });
  await fs.writeFile(path.join(ROOT, "og-image.png"), og);
  console.log("  + og-image.png (1200x1200)");

  console.log("> Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
