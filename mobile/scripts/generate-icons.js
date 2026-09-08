/**
 * Generates mobile/assets/{icon,adaptive-icon,splash}.png from frontend/public/icon.svg.
 *
 * sharp is not (and must not be) a mobile/ dependency (P9 in prd.md: no dependency changes
 * to mobile/); it is resolved from frontend/node_modules where it is already installed.
 *
 * Run: node mobile/scripts/generate-icons.js
 */

const path = require('path');
const fs = require('fs');

const frontendDir = path.join(__dirname, '../../frontend');
const sharpPath = require.resolve('sharp', { paths: [frontendDir] });
const sharp = require(sharpPath);

const svgPath = path.join(frontendDir, 'public/icon.svg');
const outputDir = path.join(__dirname, '../assets');

const targets = [
  { name: 'icon.png', size: 1024 },
  { name: 'adaptive-icon.png', size: 1024 },
  { name: 'splash.png', size: 1024 },
];

async function generateIcons() {
  const svg = fs.readFileSync(svgPath);

  for (const { name, size } of targets) {
    await sharp(svg).resize(size, size).png().toFile(path.join(outputDir, name));
    console.log(`Generated ${name}`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
