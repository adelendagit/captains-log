#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

async function generate() {
  const root = path.join(__dirname, "..");
  const sourcePath = path.join(root, "public", "icons", "logo.svg");
  const outputPath = path.join(
    root,
    "ios",
    "CaptainsLog",
    "Assets.xcassets",
    "AppIcon.appiconset",
    "AppIcon.png",
  );

  const source = await fs.promises.readFile(sourcePath, "utf8");
  const croppedLogo = source.replace(
    'viewBox="0 0 100 100"',
    'viewBox="18 18 64 64"',
  );
  const mark = await sharp(Buffer.from(croppedLogo), { density: 1024 })
    .resize(700, 700, { fit: "contain" })
    .png()
    .toBuffer();

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 3,
      background: "#f4f0e7",
    },
  })
    .composite([{ input: mark, gravity: "center" }])
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  console.log(`Wrote ${outputPath}`);
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
