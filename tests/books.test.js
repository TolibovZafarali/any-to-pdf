import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';

let server, browser, page;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch();
});
beforeEach(async () => {
  // Each test gets a fresh context; reloads within it retain the reader's storage.
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  await page.goto(new URL('books/', server.resolvedUrls.local[0]).href);
});
afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  await server?.close();
});

async function unlock() {
  await page.getByLabel('Password', { exact: true }).fill('kalimdor123');
  await page.getByRole('button', { name: 'Unlock library', exact: true }).click();
  await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).waitFor();
}

async function openBook() {
  await page.getByRole('button', { name: /^(Read book|Continue reading)$/ }).first().click();
  await page.getByLabel('Page', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#pdf-canvas');
    return canvas?.dataset.page && document.querySelector('#reader')?.getAttribute('aria-busy') === 'false';
  });
}

async function goToPage(number) {
  const input = page.getByLabel('Page', { exact: true });
  await input.fill(String(number));
  await input.press('Enter');
  await page.waitForFunction(expected => document.querySelector('#pdf-canvas')?.dataset.page === String(expected) && document.querySelector('#reader')?.getAttribute('aria-busy') === 'false', number);
}

test('the library gate rejects a wrong password and can be locked again', async () => {
  // Both the requested /books URL and the directory form must resolve in production.
  await page.goto(new URL('books', server.resolvedUrls.local[0]).href);
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Unlock library', exact: true }).click();
  assert(await page.getByLabel('Password', { exact: true }).isVisible());
  assert.match(await page.locator('#password-error').textContent(), /password/i);
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isHidden());
  await unlock();
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Lock library', exact: true }).click();
  await page.reload();
  assert(await page.getByLabel('Password', { exact: true }).isVisible());
});

test('the bundled PDF renders inside the reader and progress survives a reload', async () => {
  await unlock();
  const pdfResponse = page.waitForResponse(response => response.url().includes('/books/orwellanimalfarm.pdf') && response.ok());
  await openBook();
  assert.match((await (await pdfResponse).body()).subarray(0, 5).toString(), /^%PDF-/);
  assert(await page.getByRole('button', { name: 'Previous page', exact: true }).isDisabled());
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#pdf-canvas')?.dataset.page === '2' && document.querySelector('#reader')?.getAttribute('aria-busy') === 'false');
  await goToPage(5);
  // A canvas filled only with the page background would not prove the book rendered.
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#pdf-canvas');
    if (!canvas?.width || !canvas.height) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) return true;
    }
    return false;
  });
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.reload();
  if (await page.getByLabel('Password', { exact: true }).isVisible()) await unlock();
  await openBook();
  assert.equal(await page.getByLabel('Page', { exact: true }).inputValue(), '5');
});

test('finished status persists and the shelf filters reflect it', async () => {
  await unlock();
  await openBook();
  await page.getByRole('button', { name: 'Mark as finished', exact: true }).click();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.getByRole('button', { name: /^Finished/ }).click();
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isVisible());
  await page.reload();
  if (await page.getByLabel('Password', { exact: true }).isVisible()) await unlock();
  await page.getByRole('button', { name: /^Reading/ }).click();
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isHidden());
  await page.getByRole('button', { name: /^Finished/ }).click();
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Mark as unread', exact: true }).click();
  assert(await page.locator('#book-grid').getByRole('heading', { name: 'Animal Farm', exact: true }).isHidden());
  await page.getByRole('button', { name: 'All books', exact: true }).click();
  assert(await page.getByRole('button', { name: 'Read book', exact: true }).isVisible());
});

test('the original image converter remains available at the root', async () => {
  await page.goto(server.resolvedUrls.local[0]);
  assert(await page.getByLabel('Save PDF as').isVisible());
  assert(await page.locator('#image-input').count());
  assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
});
