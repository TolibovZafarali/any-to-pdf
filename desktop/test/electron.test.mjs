import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { _electron as electron } from 'playwright';

const require = createRequire(import.meta.url);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const fixturePDF = fileURLToPath(new URL('../../public/books/orwellanimalfarm.pdf', import.meta.url));

async function waitForPage(page, number) {
  await page.waitForFunction(expected => {
    const reader = document.querySelector('#reader');
    return reader?.getAttribute('aria-busy') === 'false' && document.querySelector('#text-page')?.dataset.page === String(expected);
  }, number);
}

test('the native app imports, pins, resizes and restores its copied PDF and saved page after restart', { timeout: 120_000 }, async () => {
  await access(path.join(desktop, 'ui', 'index.html'));
  const directory = await mkdtemp(path.join(tmpdir(), 'folio-electron-test-'));
  const profile = path.join(directory, 'profile');
  const original = path.join(directory, 'Animal Farm.pdf');
  await mkdir(profile);
  await copyFile(fixturePDF, original);
  // Keep tests completely separate from any real library. This wrapper calls
  // Electron's public API before production main code, without adding app hooks.
  const wrapper = path.join(directory, 'launch.cjs');
  await writeFile(wrapper, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(profile)});\nrequire(${JSON.stringify(path.join(desktop, 'main.cjs'))});\n`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const args = [wrapper];
  if (process.platform === 'linux') args.unshift('--no-sandbox', '--ozone-platform=headless', '--disable-gpu', '--ozone-override-screen-size=1440,1000');
  let application;
  const launch = async () => {
    application = await electron.launch({ executablePath: require('electron'), args, env, timeout: 30_000 });
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), profile);
    const page = await application.firstWindow();
    page.setDefaultTimeout(20_000);
    return page;
  };
  try {
    let page = await launch();
    await page.locator('#welcome').waitFor();
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, original);
    await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
    await waitForPage(page, 1);
    assert.match(await page.locator('#text-content').textContent(), /Manor Farm/);
    assert.equal(await page.locator('#book-title').textContent(), 'Animal Farm');
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-desktop-reader.png') });
    await page.getByLabel('Page', { exact: true }).fill('7');
    await page.getByLabel('Page', { exact: true }).press('Enter');
    await waitForPage(page, 7);
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    assert(await page.locator('#canvas').isVisible());
    const hasInk = await page.locator('#canvas').evaluate(canvas => {
      const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < bytes.length; i += 4) if (bytes[i + 3] && bytes[i] < 160 && bytes[i + 1] < 160 && bytes[i + 2] < 160) return true;
      return false;
    });
    assert(hasInk, 'the PDF canvas should contain the actual page');
    await page.getByRole('button', { name: 'Keep on top', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#pin')?.getAttribute('aria-pressed') === 'true');
    // Ozone's headless platform has no window manager and reports false here.
    // Windows CI verifies real native pinning; Linux still verifies persistence.
    if (process.platform !== 'linux') assert(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()));
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 25, y: 30, width: 420, height: 580 }));
    await page.waitForFunction(() => innerWidth <= 420);
    await page.waitForTimeout(300);
    await waitForPage(page, 7);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    if (process.env.FOLIO_TEST_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.FOLIO_TEST_SCREENSHOTS, 'folio-desktop-small.png') });
    const nativeBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds());
    assert.equal(nativeBounds.width, 420);
    assert.equal(nativeBounds.height, 580);
    // application.close() uses the real quit path and waits for the main process.
    await application.close(); application = null;
    const saved = JSON.parse(await readFile(path.join(profile, 'library.json'), 'utf8'));
    assert.equal(saved.books[0].page, 7);
    assert.equal(saved.books[0].totalPages, 71);
    assert.equal(saved.alwaysOnTop, true);
    assert.equal(saved.windowBounds.width, 420);
    assert.equal(saved.windowBounds.height, 580);
    await rm(original);

    page = await launch();
    await waitForPage(page, 7);
    assert.equal(await page.getByLabel('Page', { exact: true }).inputValue(), '7');
    assert.equal(await page.locator('#book-title').textContent(), 'Animal Farm');
    assert.match(await page.locator('#save-status').textContent(), /saved/);
    assert.equal(await page.locator('#pin').getAttribute('aria-pressed'), 'true');
    const restored = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      return { bounds: window.getNormalBounds(), pinned: window.isAlwaysOnTop() };
    });
    assert.equal(restored.bounds.width, 420);
    assert.equal(restored.bounds.height, 580);
    if (process.platform !== 'linux') assert(restored.pinned);
    await page.getByRole('button', { name: 'Show bookshelf', exact: true }).click();
    assert.match(await page.locator('#books').textContent(), /Animal Farm/);
    assert.match(await page.locator('#books').textContent(), /Page 7 of 71/);
  } finally {
    if (application) await application.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
