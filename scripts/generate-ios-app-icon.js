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

  const source = await fs.promises.readFile(sourcePath);

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(source, { density: 1024 })
    .resize(1024, 1024, { fit: "cover" })
    .flatten({ background: "#0A2540" })
    .removeAlpha()
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);

  console.log(`Wrote ${outputPath}`);
}

generate().catch((error) => {
  console.error(error);
  process.exit(1);
});
