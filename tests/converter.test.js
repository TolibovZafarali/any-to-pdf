import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import tiff from 'utif2';
import { preview } from 'vite';

const svg = {
  name: 'Sample.svg',
  mimeType: 'application/octet-stream',
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>'),
};
let server, browser, page;

before(async () => {
  server = await preview({ logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch();
});

beforeEach(async () => {
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(server.resolvedUrls.local[0]);
});

afterEach(async () => { await page?.close(); });
after(async () => {
  await browser?.close();
  await server?.close();
});

async function downloadFrom(button, expectedName) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  assert.equal(download.suggestedFilename(), expectedName);
  return readFile(await download.path());
}

test('damaged TIFFs do not block a later image in the same selection', async () => {
  // The directory points back to itself. The second file advertises more pixels than it contains.
  const cycle = Buffer.from([73, 73, 42, 0, 8, 0, 0, 0, 0, 0, 8, 0, 0, 0]);
  const pixels = new Uint8Array(24 * 18 * 4).fill(255);
  const truncated = tiff.encodeImage(pixels.buffer, 24, 18).slice(0, -250);
  const zeroTile = tiff.encodeImage(pixels.buffer, 24, 18, { t322: [0], t323: [16], t324: [1000], t325: [1728] });
  await page.locator('#image-input').setInputFiles([
    { name: 'Cycle.tif', mimeType: 'image/tiff', buffer: cycle },
    { name: 'Incomplete.tif', mimeType: 'image/tiff', buffer: Buffer.from(truncated) },
    { name: 'Zero tile.tif', mimeType: 'image/tiff', buffer: Buffer.from(zeroTile) },
    svg,
  ]);
  await page.locator('#message').waitFor();
  const errors = await page.locator('#message-text').textContent();
  assert.match(errors, /Cycle\.tif/);
  assert.match(errors, /Incomplete\.tif/);
  assert.match(errors, /Zero tile\.tif/);
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Sample.svg']);
  const bytes = await downloadFrom(page.locator('#convert'), 'Sample.pdf');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 60, height: 30 });
});

test('a failed export can be retried and the resulting PDF downloaded under a new name', async () => {
  await page.locator('#image-input').setInputFiles(svg);
  await page.locator('.image-row').waitFor();
  await page.getByLabel('Save PDF as').fill('Field notes.旅行.pdf.PDF');
  // Trigger a real encoder failure after the thumbnail has already been prepared.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      HTMLCanvasElement.prototype.toBlob = encode;
      callback(null);
    };
  });
  const convert = page.locator('#convert');
  await convert.click();
  await page.locator('#export-error').waitFor();
  assert(await convert.isEnabled());
  const bytes = await downloadFrom(convert, 'Field notes.旅行.pdf');
  assert(await page.locator('#export-error').isHidden());
  await page.getByLabel('Save PDF as').fill('Revised copy');
  const renamed = await downloadFrom(page.locator('#download'), 'Revised copy.pdf');
  assert.deepEqual(renamed, bytes);
  await page.getByLabel('Page size').selectOption('letter');
  assert(await page.locator('#download').isHidden());
  const letter = await PDFDocument.load(await downloadFrom(convert, 'Revised copy.pdf'));
  assert.deepEqual(letter.getPage(0).getSize(), { width: 792, height: 612 });
});

test('clearing all images starts a fresh batch with the chosen export settings', async () => {
  const clear = page.getByRole('button', { name: 'Clear all', exact: true });
  const input = page.locator('#image-input');
  const filename = page.getByLabel('Save PDF as');
  const size = page.getByLabel('Page size');
  const compression = page.getByLabel('Compression');
  const convert = page.locator('#convert');
  assert(await clear.isHidden());

  await input.setInputFiles([{ ...svg, name: 'First.svg' }, svg]);
  await page.waitForFunction(() => document.querySelectorAll('.image-row').length === 2 && !document.querySelector('#convert').disabled);
  await filename.fill('Old batch');
  await size.selectOption('letter');
  await compression.selectOption('small');
  await downloadFrom(convert, 'Old batch.pdf');
  await clear.click();

  assert.equal(await page.locator('.image-row').count(), 0);
  assert.equal(await page.locator('#image-count').textContent(), '0 images');
  assert.equal(await page.locator('#convert-hint').textContent(), '0 pages');
  assert.equal(await filename.inputValue(), '');
  assert.equal(await size.inputValue(), 'letter');
  assert.equal(await compression.inputValue(), 'small');
  assert(await clear.isHidden());
  assert(await convert.isDisabled());
  assert(await page.locator('#download').isHidden());
  assert.equal(await page.locator('#download').getAttribute('href'), null);
  assert(await page.locator('#choose').evaluate(button => document.activeElement === button));

  await input.setInputFiles(svg);
  const pdf = await PDFDocument.load(await downloadFrom(convert, 'Sample.pdf'));
  assert.equal(pdf.getPageCount(), 1);
  assert(await clear.isVisible());
});

test('paste respects the filename editor and open dialogs', async () => {
  async function pasteOn(selector) {
    return page.locator(selector).evaluate(target => {
      const data = new DataTransfer();
      data.items.add('Copied name', 'text/plain');
      data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'], 'Copied.svg', { type: 'image/svg+xml' }));
      return target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
  }
  await page.locator('#filename').focus();
  assert(await pasteOn('#filename'), 'the text editor should receive its normal paste');
  await page.getByRole('button', { name: 'How it works' }).click();
  assert(await pasteOn('#close-dialog'), 'a dialog paste should leave the queue alone');
  await page.keyboard.press('Escape');
  assert(!(await pasteOn('#choose')), 'the workspace should accept the image paste');
  await page.locator('.image-row').waitFor();
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Copied.svg']);
});

test('downloading waits for pending clipboard images and recovers from denial', async () => {
  await page.locator('#image-input').setInputFiles(svg);
  const convert = page.locator('#convert');
  await downloadFrom(convert, 'Sample.pdf');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read() {
          return new Promise((resolve, reject) => {
            window.allowPaste = () => resolve([new ClipboardItem({
              'image/svg+xml': new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"/>'], { type: 'image/svg+xml' }),
            })]);
            window.denyPaste = () => reject(new DOMException('Permission denied', 'NotAllowedError'));
          });
        },
      },
    });
  });
  const paste = page.locator('#paste');
  await paste.click();
  assert(await convert.isDisabled());
  assert(await page.locator('#clear-all').isDisabled());
  assert(await page.locator('#download').isHidden());
  await page.evaluate(() => window.denyPaste());
  await page.locator('#message').waitFor();
  assert(await convert.isEnabled());
  assert(await page.locator('#clear-all').isEnabled());
  assert(await page.locator('#download').isVisible());

  await paste.click();
  await page.evaluate(() => window.allowPaste());
  const pdf = await PDFDocument.load(await downloadFrom(convert, 'Sample.pdf'));
  assert.equal(pdf.getPageCount(), 2);
});

test('queued JPEGs export with their settings when the connection drops before download', async () => {
  const buffer = await readFile(new URL('./fixtures/compressed.jpg', import.meta.url));
  const names = Array.from({ length: 6 }, (_, index) => `Photo ${index + 1}.jpg`);
  await page.locator('#image-input').setInputFiles(names.map(name => ({ name, mimeType: 'image/jpeg', buffer })));
  await page.waitForFunction(() => document.querySelectorAll('.image-row').length === 6 && !document.querySelector('#convert').disabled);
  await page.getByLabel('Save PDF as').fill('Travel album');
  await page.getByLabel('Page size').selectOption('letter');
  await page.getByLabel('Compression').selectOption('small');

  // No export has warmed a module cache. A loaded converter must not need a
  // late network request (or a reload that would discard this prepared queue).
  await page.context().setOffline(true);
  const bytes = await downloadFrom(page.locator('#convert'), 'Travel album.pdf');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 6);
  for (const pdfPage of pdf.getPages()) assert.deepEqual(pdfPage.getSize(), { width: 792, height: 612 });
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), names);
  assert.equal(await page.getByLabel('Save PDF as').inputValue(), 'Travel album');
  assert.equal(await page.getByLabel('Page size').inputValue(), 'letter');
  assert.equal(await page.getByLabel('Compression').inputValue(), 'small');
  assert(await page.locator('#export-error').isHidden());
});

test('a small baseline JPEG keeps its data while private JPEG comments are discarded', async () => {
  const original = await readFile(new URL('./fixtures/compressed.jpg', import.meta.url));
  const input = page.locator('#image-input');
  await input.setInputFiles({ name: 'Photo.jpg', mimeType: 'image/jpeg', buffer: original });
  const bytes = await downloadFrom(page.locator('#convert'), 'Photo.pdf');
  assert(bytes.includes(original), 'keep the smaller source JPEG when it already fits the page');

  // Insert a JPEG comment after the fixture's 20-byte JFIF header.
  const comment = Buffer.from('Private camera note');
  const header = Buffer.from([0xff, 0xfe, 0, comment.length + 2]);
  const tagged = Buffer.concat([original.subarray(0, 20), header, comment, original.subarray(20)]);
  await page.locator('[data-action="remove"]').click();
  await input.setInputFiles({ name: 'Tagged.jpg', mimeType: 'image/jpeg', buffer: tagged });
  const sanitized = await downloadFrom(page.locator('#convert'), 'Tagged.pdf');
  assert(!sanitized.includes(comment));
  const pdf = await PDFDocument.load(sanitized);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 72, height: 60 });
});

test('a subsampled TIFF preserves red in its preview and exports a page', async () => {
  // A 4×4 raw YCbCr image with 2×2 chroma subsampling and one full-height strip.
  const buffer = await readFile(new URL('./fixtures/subsampled-red.tif', import.meta.url));
  await page.locator('#image-input').setInputFiles({ name: 'Red.tif', mimeType: 'image/tiff', buffer });
  const preview = page.locator('.image-row img');
  await preview.waitFor();
  const [r, g, b] = await preview.evaluate(async image => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 4;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(1, 1, 1, 1).data);
  });
  assert(r > 180 && g < 60 && b < 60, 'the red sample should remain red');
  const pdf = await PDFDocument.load(await downloadFrom(page.locator('#convert'), 'Red.pdf'));
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 3, height: 3 });
});

const reorderImages = Array.from({ length: 5 }, (_, index) => ({
  name: `Page ${index + 1}.svg`,
  mimeType: 'image/svg+xml',
  buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${40 * (index + 1)}" height="40"><rect width="100%" height="100%" fill="red"/></svg>`),
}));

async function prepareReorderImages(count = 5) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('#image-input').setInputFiles(reorderImages.slice(0, count));
  await page.waitForFunction(total => document.querySelectorAll('.image-row').length === total && !document.querySelector('#convert').disabled, count);
  await page.getByLabel('Save PDF as').fill('Ordered pages');
}

function imageCard(name) {
  return page.locator('.image-row').filter({ has: page.locator('.image-detail strong', { hasText: name }) });
}

async function dragCard(name, destination, after, target = '.reorder-handle') {
  const handle = imageCard(name).locator(target);
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const end = await imageCard(destination).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, { steps: 4 });
  const destinationX = end.x + end.width * (after ? 0.8 : 0.2);
  const destinationY = end.y + end.height / 2;
  await page.mouse.move(destinationX, destinationY, { steps: 20 });
  // Let the cards settle before the final dragover and release at this position.
  await page.waitForTimeout(200);
  await page.mouse.move(destinationX + 1, destinationY);
  await page.mouse.up();
}

async function assertPdfOrder(order) {
  const pdf = await PDFDocument.load(await downloadFrom(page.locator('#convert'), 'Ordered pages.pdf'));
  assert.deepEqual(pdf.getPages().map(pdfPage => pdfPage.getSize()), order.map(number => ({ width: 30 * number, height: 30 })));
}

test('dragging cards between grid rows changes the PDF page order and invalidates an earlier download', async () => {
  await prepareReorderImages();
  const firstRow = await imageCard('Page 1.svg').boundingBox();
  const lastRow = await imageCard('Page 5.svg').boundingBox();
  assert(lastRow.y > firstRow.y, 'exercise a drag across rows rather than only adjacent cards');
  await assertPdfOrder([1, 2, 3, 4, 5]);

  await dragCard('Page 1.svg', 'Page 5.svg', true);
  await page.waitForFunction(() => document.querySelector('#queue > :last-child .image-detail strong')?.textContent === 'Page 1.svg');
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 2.svg', 'Page 3.svg', 'Page 4.svg', 'Page 5.svg', 'Page 1.svg']);
  assert(await page.locator('#download').isHidden());
  assert.equal(await page.locator('#image-count').textContent(), '5 images');
  await assertPdfOrder([2, 3, 4, 5, 1]);

  await dragCard('Page 1.svg', 'Page 2.svg', false, 'img');
  await page.waitForFunction(() => document.querySelector('#queue > :first-child .image-detail strong')?.textContent === 'Page 1.svg');
  assert(await page.locator('#download').isHidden());
  await assertPdfOrder([1, 2, 3, 4, 5]);
  assert.deepEqual(await page.locator('.page-number').allTextContents(), ['1', '2', '3', '4', '5']);
});

test('keyboard reordering and removal set the export order and controls lock during export', async () => {
  await prepareReorderImages(3);
  const handle = imageCard('Page 1.svg').locator('.reorder-handle');
  await handle.focus();
  await handle.press('End');
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 2.svg', 'Page 3.svg', 'Page 1.svg']);
  await handle.press('Home');
  await handle.press('ArrowRight');
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 2.svg', 'Page 1.svg', 'Page 3.svg']);
  await page.getByRole('button', { name: 'Remove Page 3.svg', exact: true }).click();

  // Keep the actual JPEG encoder pending long enough to exercise the export lock.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      HTMLCanvasElement.prototype.toBlob = encode;
      window.finishEncoding = () => encode.call(this, callback, type, quality);
    };
  });
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#convert').click();
  await page.waitForFunction(() => typeof window.finishEncoding === 'function');
  for (const control of await page.locator('.reorder-handle, [data-action="remove"]').all()) assert(await control.isDisabled());
  await page.evaluate(() => window.finishEncoding());
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), 'Ordered pages.pdf');
  const pdf = await PDFDocument.load(await readFile(await download.path()));
  assert.deepEqual(pdf.getPages().map(pdfPage => pdfPage.getSize()), [{ width: 60, height: 30 }, { width: 30, height: 30 }]);
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 2.svg', 'Page 1.svg']);
  assert(await handle.isEnabled());
});

test('dropping a card outside the queue cancels without importing it and real file drops still work', async () => {
  await prepareReorderImages(2);
  await assertPdfOrder([1, 2]);
  const savedDownload = await page.locator('#download').getAttribute('href');
  const handle = imageCard('Page 1.svg').locator('.reorder-handle');
  const start = await handle.boundingBox();
  const outside = await page.locator('#drop-zone').boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 12, start.y + start.height / 2, { steps: 4 });
  await page.mouse.move(outside.x + outside.width / 2, outside.y + outside.height / 2, { steps: 20 });
  await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector('#convert').disabled);
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 1.svg', 'Page 2.svg']);
  assert.equal(await page.locator('#download').getAttribute('href'), savedDownload);
  assert(await page.locator('#download').isVisible());
  assert(await page.locator('#message').isHidden());

  await page.locator('#drop-zone').evaluate(target => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="80"><rect width="40" height="80" fill="blue"/></svg>'], 'Dropped.svg', { type: 'image/svg+xml' }));
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => document.querySelectorAll('.image-row').length === 3 && !document.querySelector('#convert').disabled);
  assert.deepEqual(await page.locator('.image-detail strong').allTextContents(), ['Page 1.svg', 'Page 2.svg', 'Dropped.svg']);
  assert.equal(await page.locator('#image-count').textContent(), '3 images');
  assert(await page.locator('#download').isHidden());
  const pdf = await PDFDocument.load(await downloadFrom(page.locator('#convert'), 'Ordered pages.pdf'));
  assert.deepEqual(pdf.getPages().map(pdfPage => pdfPage.getSize()), [{ width: 30, height: 30 }, { width: 60, height: 30 }, { width: 30, height: 60 }]);
});
