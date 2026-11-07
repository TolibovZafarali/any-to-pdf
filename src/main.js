import {
  createElement, Plus, ChevronDown, ShieldCheck, CircleHelp,
  X, CircleCheck, Download, Info, ArrowLeft, ArrowRight,
} from 'lucide';
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
  clearAll.disabled = importing || exporting;
  convert.disabled = !items.length || importing || exporting;
  byId('result').hidden = !resultUrl || importing;
  pageSize.disabled = compression.disabled = filename.disabled = exporting;
  chooseButton.disabled = pasteButton.disabled = exporting;
  chooseButton.querySelector('span').textContent = preparing ? 'Preparing images…' : 'Choose images';
  dropZone.classList.toggle('compact', items.length > 0);
  byId('drop-title').textContent = items.length ? 'Add more images' : 'Drop images here';
  byId('image-count').textContent = items.length + (items.length === 1 ? ' image' : ' images');
  queue.hidden = !items.length;
  const inputSize = items.reduce((total, item) => total + item.size, 0);
  const summary = items.length ? pageCount(items.length) + ' · ' + formatSize(inputSize) : '0 pages';
  byId('convert-hint').textContent = clipboardPending ? 'Reading clipboard…' : summary;
}

async function addFiles(files) {
  if (exporting) {
    showMessage('Your PDF is being created. Add more images when it is ready.');
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
        refreshRows();
        updateControls();
      } catch (error) {
        errors.push(file.name + ' — ' + error.message);
      }
    }
  } finally {
    preparing = false;
    refreshRows();
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
    ['earlier', 'Move ' + item.name + ' earlier', ArrowLeft],
    ['later', 'Move ' + item.name + ' later', ArrowRight],
    ['remove', 'Remove ' + item.name, X],
  ];
  for (const [action, label, shape] of controls) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.append(icon(shape));
    actions.append(button);
  }
  row.append(number, thumb, detail, actions);
  return row;
}
function refreshRows() {
  Array.from(queue.children).forEach((row, index) => {
    row.querySelector('.page-number').textContent = index + 1;
    row.querySelector('[data-action="earlier"]').disabled = exporting || index === 0;
    row.querySelector('[data-action="later"]').disabled = exporting || index === items.length - 1;
    row.querySelector('[data-action="remove"]').disabled = exporting;
  });
}
queue.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled || exporting) return;
  const row = button.closest('li');
  const index = items.findIndex(item => item.id === row.dataset.id);
  const action = button.dataset.action;
  const item = items[index];
  clearResult();
  if (action === 'remove') {
    items.splice(index, 1);
    if (!items.length && !filenameEdited) filename.value = '';
    URL.revokeObjectURL(item.thumbnail);
    row.remove();
    (queue.children[index]?.querySelector('[data-action="remove"]') ||
      queue.lastElementChild?.querySelector('[data-action="remove"]') || chooseButton).focus();
    announce(item.name + ' removed.');
  } else {
    const target = index + (action === 'earlier' ? -1 : 1);
    items.splice(target, 0, items.splice(index, 1)[0]);
    if (target < index) row.previousElementSibling.before(row);
    else row.nextElementSibling.after(row);
    announce(item.name + ' moved to page ' + (target + 1) + '.');
  }
  refreshRows();
  updateControls();
  if (action !== 'remove') {
    (button.disabled ? row.querySelector('button:not(:disabled)') : button)?.focus();
  }
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
  refreshRows();
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
    refreshRows();
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
  '<ol class="help-steps"><li><strong>Add your images</strong>Choose files, drop them in the image area, or paste a copied image or screenshot.</li><li><strong>Arrange your pages</strong>Each image becomes one page. Use the arrows to change their order.</li><li><strong>Name and download</strong>Enter a file name, choose your page size and compression, then select Download PDF.</li></ol>'));
byId('close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
updateControls();
