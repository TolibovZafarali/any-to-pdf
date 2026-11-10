import {
  createElement, Plus, ChevronDown, ShieldCheck, CircleHelp,
  X, CircleCheck, Download, Info, GripVertical,
} from 'lucide';
import Sortable from 'sortablejs';
import { artwork } from './art.js';
import { wireIntake } from './intake.js';
import { prepareImage, exportPdf } from './conversion.js';
import './style.css';

const icons = {
  plus: Plus, chevron: ChevronDown, shield: ShieldCheck, help: CircleHelp, close: X,
  success: CircleCheck, download: Download, info: Info,
};
const byId = id => document.getElementById(id);
function icon(shape) {
  return createElement(shape, { 'aria-hidden': 'true', 'stroke-width': 1.7, width: 18, height: 18 });
}
for (const placeholder of document.querySelectorAll('[data-icon]')) {
  const svg = icon(icons[placeholder.dataset.icon]);
  if (placeholder.className) svg.setAttribute('class', placeholder.className);
  placeholder.replaceWith(svg);
}
byId('artwork').innerHTML = artwork;
if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
  byId('modifier').textContent = '⌘';
}

const queue = byId('queue');
const dropZone = byId('drop-zone');
const chooseButton = byId('choose');
const pasteButton = byId('paste');
const input = byId('image-input');
const clearAll = byId('clear-all');
const convert = byId('convert');
const convertText = convert.querySelector('span');
const filename = byId('filename');
const pageSize = byId('page-size');
const compression = byId('compression');
const download = byId('download');
const exportError = byId('export-error');
const items = [];
const waiting = [];
let preparing = false;
let clipboardPending = false;
let exporting = false;
let reordering = false;
let filenameEdited = false;
let resultUrl;

function pageCount(n) { return n === 1 ? '1 page' : n + ' pages'; }
function formatSize(bytes) {
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' MB';
  return Math.max(1, Math.round(bytes / 1000)) + ' KB';
}
function filenameStem(value) {
  const clean = value.normalize('NFC').trim()
    .replace(/[<>:"/\\|?*\p{Cc}\p{Cf}\p{Cs}\p{Noncharacter_Code_Point}]/gu, '-');
  const encoder = new TextEncoder();
  let stem = '';
  let bytes = 0;
  // Leave room for the extension and for the browser's duplicate-download suffix.
  for (const character of clean) {
    bytes += encoder.encode(character).length;
    if (bytes > 240) break;
    stem += character;
  }
  stem = stem.replace(/[.\s]+$/u, '');
  while (/\.pdf$/i.test(stem)) stem = stem.slice(0, -4).replace(/[.\s]+$/u, '');
  stem = stem.replace(/^[.\s]+/u, '');
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem || 'Untitled';
}
function updateDownloadName() {
  const name = filenameStem(filename.value) + '.pdf';
  download.download = name;
  byId('result-name').textContent = name;
}
function announce(text) { byId('live-status').textContent = text; }
function clearResult() {
  byId('result').hidden = true;
  exportError.hidden = true;
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = undefined;
  download.removeAttribute('href');
}
function showMessage(message) {
  byId('message').hidden = false;
  byId('message-text').textContent = message;
}

function updateControls() {
  const importing = clipboardPending || preparing;
  clearAll.hidden = !items.length;
  clearAll.disabled = importing || exporting || reordering;
  convert.disabled = !items.length || importing || exporting || reordering;
  byId('result').hidden = !resultUrl || importing || reordering;
  pageSize.disabled = compression.disabled = filename.disabled = exporting || reordering;
  chooseButton.disabled = pasteButton.disabled = exporting || reordering;
  const reorderDisabled = importing || exporting || items.length < 2;
  sorter.option('disabled', reorderDisabled);
  queue.dataset.reorderDisabled = String(reorderDisabled);
  byId('reorder-hint').hidden = items.length < 2;
  chooseButton.querySelector('span').textContent = preparing ? 'Preparing images…' : 'Choose images';
  dropZone.classList.toggle('compact', items.length > 0);
  byId('drop-title').textContent = items.length ? 'Add more images' : 'Drop images here';
  byId('image-count').textContent = items.length + (items.length === 1 ? ' image' : ' images');
  queue.hidden = !items.length;
  const inputSize = items.reduce((total, item) => total + item.size, 0);
  const summary = items.length ? pageCount(items.length) + ' · ' + formatSize(inputSize) : '0 pages';
  byId('convert-hint').textContent = clipboardPending ? 'Reading clipboard…' : summary;
  refreshRows();
}

async function addFiles(files) {
  if (exporting || reordering) {
    showMessage(exporting ? 'Your PDF is being created. Add more images when it is ready.' : 'Finish arranging your photos, then add more images.');
    return;
  }
  waiting.push(...files);
  if (preparing) return;
  preparing = true;
  byId('message').hidden = true;
  const errors = [];
  updateControls();
  try {
    while (waiting.length) {
      const file = waiting.shift();
      try {
        const item = await prepareImage(file);
        clearResult();
        if (!items.length && !filenameEdited) {
          const extension = item.name.lastIndexOf('.');
          filename.value = filenameStem(extension > 0 ? item.name.slice(0, extension) : item.name);
        }
        items.push(item);
        queue.append(imageRow(item));
        updateControls();
      } catch (error) {
        errors.push(file.name + ' — ' + error.message);
      }
    }
  } finally {
    preparing = false;
    updateControls();
    if (errors.length) showMessage(errors.join('\n'));
    announce(pageCount(items.length) + ' ready.');
  }
}

function imageRow(item) {
  const row = document.createElement('li');
  row.className = 'image-row';
  row.dataset.id = item.id;
  const number = document.createElement('span');
  number.className = 'page-number';
  number.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('img');
  thumb.src = item.thumbnail;
  thumb.alt = '';
  thumb.draggable = false;
  const detail = document.createElement('div');
  detail.className = 'image-detail';
  const name = document.createElement('strong');
  name.textContent = item.name;
  name.title = item.name;
  const size = document.createElement('small');
  size.textContent = item.width + ' × ' + item.height + ' · ' + formatSize(item.size);
  detail.append(name, size);
  const actions = document.createElement('div');
  actions.className = 'row-actions';
  const controls = [
    ['reorder', 'Reorder ' + item.name, GripVertical],
    ['remove', 'Remove ' + item.name, X],
  ];
  for (const [action, label, shape] of controls) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (action === 'reorder') {
      button.className = 'reorder-handle';
      button.setAttribute('aria-describedby', 'reorder-instructions');
      button.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home End');
      button.title = 'Drag to reorder, or focus and use the arrow keys';
    }
    button.append(icon(shape));
    actions.append(button);
  }
  row.append(number, thumb, detail, actions);
  return row;
}
function refreshRows() {
  Array.from(queue.children).forEach((row, index) => {
    row.querySelector('.page-number').textContent = index + 1;
    const handle = row.querySelector('.reorder-handle');
    handle.disabled = exporting || preparing || clipboardPending || items.length < 2;
    const name = row.querySelector('.image-detail strong').textContent;
    handle.setAttribute('aria-label', 'Reorder ' + name + ', page ' + (index + 1) + ' of ' + items.length);
    row.querySelector('[data-action="remove"]').disabled = exporting || reordering;
  });
}

// Sort the existing cards, then commit their order to the PDF's source array
// once the gesture ends. Releasing outside the queue restores the old order.
const sorter = new Sortable(queue, {
  draggable: '.image-row',
  handle: '.image-row img, .reorder-handle',
  animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
  fallbackOnBody: true,
  fallbackTolerance: 5,
  delay: 180,
  delayOnTouchOnly: true,
  touchStartThreshold: 5,
  revertOnSpill: true,
  onStart() {
    reordering = true;
    updateControls();
  },
  onChange: refreshRows,
  onEnd({ item: row, originalEvent }) {
    if (['pointercancel', 'touchcancel', 'dragend'].includes(originalEvent?.type)) {
      sorter.sort(items.map(item => item.id));
    }
    const imagesById = new Map(items.map(item => [item.id, item]));
    const reordered = sorter.toArray().map(id => imagesById.get(id));
    const changed = reordered.some((item, index) => item !== items[index]);
    if (changed) {
      items.splice(0, items.length, ...reordered);
      clearResult();
      const index = items.findIndex(item => item.id === row.dataset.id);
      announce(items[index].name + ' moved to page ' + (index + 1) + '.');
    }
    reordering = false;
    updateControls();
  },
});

queue.addEventListener('keydown', event => {
  const handle = event.target.closest('.reorder-handle');
  if (!handle || handle.disabled || reordering || event.altKey || event.ctrlKey || event.metaKey) return;
  const row = handle.closest('.image-row');
  const index = items.findIndex(item => item.id === row.dataset.id);
  const targets = { ArrowLeft: index - 1, ArrowUp: index - 1, ArrowRight: index + 1, ArrowDown: index + 1, Home: 0, End: items.length - 1 };
  if (!(event.key in targets)) return;
  event.preventDefault();
  const target = Math.max(0, Math.min(items.length - 1, targets[event.key]));
  if (target === index) return;
  if (target < index) queue.children[target].before(row);
  else queue.children[target].after(row);
  const item = items.splice(index, 1)[0];
  items.splice(target, 0, item);
  clearResult();
  updateControls();
  handle.focus({ preventScroll: true });
  row.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  announce(item.name + ' moved to page ' + (target + 1) + '.');
});

queue.addEventListener('click', event => {
  const button = event.target.closest('button[data-action="remove"]');
  if (!button || button.disabled || exporting || reordering) return;
  const row = button.closest('li');
  const index = items.findIndex(item => item.id === row.dataset.id);
  const item = items[index];
  clearResult();
  items.splice(index, 1);
  if (!items.length && !filenameEdited) filename.value = '';
  URL.revokeObjectURL(item.thumbnail);
  row.remove();
  (queue.children[index]?.querySelector('[data-action="remove"]') ||
    queue.lastElementChild?.querySelector('[data-action="remove"]') || chooseButton).focus();
  announce(item.name + ' removed.');
  updateControls();
});

clearAll.addEventListener('click', () => {
  for (const item of items) URL.revokeObjectURL(item.thumbnail);
  items.length = 0;
  queue.replaceChildren();
  clearResult();
  filename.value = '';
  filenameEdited = false;
  byId('message').hidden = true;
  updateControls();
  chooseButton.focus();
  announce('All images cleared.');
});

wireIntake({
  dropZone, input, pasteButton, onFiles: addFiles, onMessage: showMessage,
  onClipboardPending(pending) {
    clipboardPending = pending;
    updateControls();
  },
});
chooseButton.addEventListener('click', () => input.click());
byId('dismiss-message').addEventListener('click', () => {
  byId('message').hidden = true;
  chooseButton.focus();
});
pageSize.addEventListener('change', clearResult);
compression.addEventListener('change', () => {
  clearResult();
  byId('compression-hint').textContent = {
    auto: 'Compresses large images automatically.',
    small: 'Reduces resolution for a smaller PDF.',
    quality: 'Preserves more detail in each image.',
  }[compression.value];
});
filename.addEventListener('input', () => {
  filenameEdited = true;
  if (resultUrl) updateDownloadName();
});
filename.addEventListener('blur', () => {
  filename.value = filename.value.trim() ? filenameStem(filename.value) : '';
});

convert.addEventListener('click', async () => {
  if (convert.disabled) return;
  if (resultUrl) {
    updateDownloadName();
    download.click();
    return;
  }
  exportError.hidden = true;
  exporting = true;
  updateControls();
  byId('message').hidden = true;
  convertText.textContent = 'Creating PDF…';
  try {
    const blob = await exportPdf(items, { pageSize: pageSize.value, compression: compression.value }, (done, total) => {
      convertText.textContent = 'Creating PDF · ' + done + '/' + total;
    });
    resultUrl = URL.createObjectURL(blob);
    download.href = resultUrl;
    updateDownloadName();
    const inputSize = items.reduce((total, item) => total + item.size, 0);
    const savings = Math.floor((1 - blob.size / inputSize) * 100);
    const detail = pageCount(items.length) + ' · ' + formatSize(blob.size);
    byId('result-detail').textContent = savings > 0 ? detail + ' · ' + savings + '% smaller than the source images' : detail;
    byId('result').hidden = false;
    download.click();
    announce('Your PDF is ready. ' + pageCount(items.length) + ', ' + formatSize(blob.size) + '.');
  } catch (error) {
    exportError.textContent = 'Could not create the PDF. ' + error.message;
    exportError.hidden = false;
  } finally {
    exporting = false;
    convertText.textContent = 'Download PDF';
    updateControls();
  }
});

const dialog = byId('info-dialog');
function openDialog(title, content) {
  byId('dialog-title').textContent = title;
  byId('dialog-body').innerHTML = content;
  dialog.showModal();
}
byId('formats-button').addEventListener('click', () => openDialog('Supported formats',
  '<p>Paperfold accepts JPG, JPEG, PNG, WebP, GIF, BMP, SVG, HEIC, HEIF, TIFF, and other images your browser can open.</p><p>Animated images and multi-image files contribute one still image per file. Transparent areas appear white in the PDF.</p>'));
byId('help').addEventListener('click', () => openDialog('How it works',
  '<ol class="help-steps"><li><strong>Add your images</strong>Choose files, drop them in the image area, or paste a copied image or screenshot.</li><li><strong>Arrange your pages</strong>Drag a photo or its grip to change the page order. On a touchscreen, hold briefly before dragging. You can also focus a grip and use the arrow keys, Home, or End.</li><li><strong>Name and download</strong>Enter a file name, choose your page size and compression, then select Download PDF.</li></ol>'));
byId('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
updateControls();
