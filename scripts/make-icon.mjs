// Renders desktop/resources/icon.svg to the 512x512 icon.png electron-builder and the window use.
// Run by hand after editing the SVG: `node scripts/make-icon.mjs` (needs `npx playwright install chromium`).
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const svgPath = fileURLToPath(new URL('../desktop/resources/icon.svg', import.meta.url));
const pngPath = fileURLToPath(new URL('../desktop/resources/icon.png', import.meta.url));

const svg = await readFile(svgPath, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  // Offline: the SVG is inlined, so the page loads nothing.
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: pngPath, omitBackground: true });
  console.log(`wrote ${pngPath}`);
} finally {
  await browser.close();
}
