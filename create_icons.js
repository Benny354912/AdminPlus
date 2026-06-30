#!/usr/bin/env node

/**
 * Konvertiert icon.svg zu PNG-Dateien in verschiedenen Größen
 * Benötigt: npm install sharp
 */

const fs = require('fs');
const path = require('path');

// Versuche sharp zu laden, wenn nicht vorhanden → Fehler mit Installationsanweisung
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('❌ sharp ist nicht installiert. Installiere mit:');
  console.error('   npm install sharp');
  process.exit(1);
}

const iconPath = path.join(__dirname, 'icon.svg');
const sizes = [48, 96, 128];

async function convertIcon() {
  if (!fs.existsSync(iconPath)) {
    console.error(`❌ icon.svg nicht gefunden: ${iconPath}`);
    process.exit(1);
  }

  console.log('📦 Konvertiere icon.svg zu PNG...');

  for (const size of sizes) {
    const outputPath = path.join(__dirname, `icon-${size}.png`);
    try {
      await sharp(iconPath)
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(outputPath);
      console.log(`✓ ${size}x${size}: ${outputPath}`);
    } catch (err) {
      console.error(`✗ Fehler bei ${size}x${size}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\n✓ Fertig! Icons generiert:');
  sizes.forEach(s => {
    console.log(`  - icon-${s}.png (${s}x${s})`);
  });
}

convertIcon();
