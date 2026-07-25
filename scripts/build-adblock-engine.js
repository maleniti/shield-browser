// Generates blocklists/adblock-engine.bin from Ghostery's prebuilt
// ads-and-tracking lists (EasyList + EasyPrivacy, kept current on their CDN).
// Bundled at build time rather than fetched at runtime, so the app stays
// offline-friendly and starts up without a network round-trip -- run this
// manually to refresh the snapshot (`node scripts/build-adblock-engine.js`),
// then commit the updated binary.
const fs = require('fs');
const path = require('path');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

async function main() {
  const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  const buffer = blocker.serialize();
  const outPath = path.join(__dirname, '..', 'blocklists', 'adblock-engine.bin');
  fs.writeFileSync(outPath, buffer);
  console.log(`Wrote ${outPath} (${buffer.length} bytes, ${blocker.lists.size} lists loaded)`);
}

main().catch((err) => {
  console.error('Failed to build adblock engine:', err);
  process.exit(1);
});
