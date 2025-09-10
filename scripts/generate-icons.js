#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}

async function generate() {
  const srcSvg = path.join(__dirname, '..', 'public', 'icons', 'logo.svg');
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  const appleOut = path.join(__dirname, '..', 'public', 'apple-touch-icon.png');

  if (!fs.existsSync(srcSvg)) {
    console.error(`Source SVG not found: ${srcSvg}`);
    process.exit(1);
  }

  await ensureDir(outDir);

  const targets = [
    { size: 192, file: path.join(outDir, 'icon-192.png') },
    { size: 512, file: path.join(outDir, 'icon-512.png') },
    { size: 180, file: appleOut }, // iOS apple-touch icon
  ];

  for (const t of targets) {
    // High density rasterization for crisp small sizes
    const svgBuffer = await fs.promises.readFile(srcSvg);
    const image = sharp(svgBuffer, { density: 1024 });
    const png = image
      .resize(t.size, t.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true });
    await png.toFile(t.file);
    console.log(`Wrote ${t.file}`);
  }
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});

