import { createElement, BookOpen, Leaf, Lock, Eye, EyeOff, Bookmark, ArrowRight, ArrowLeft, Search, ChevronLeft, ChevronRight, Minus, Plus, Check } from 'lucide';
import { books } from './catalog.js';
import './style.css';

const icons = { 'book-open': BookOpen, leaf: Leaf, lock: Lock, eye: Eye, 'eye-off': EyeOff, bookmark: Bookmark, 'arrow-right': ArrowRight, 'arrow-left': ArrowLeft, search: Search, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, minus: Minus, plus: Plus, check: Check };
const $ = id => document.getElementById(id);
function decorate(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) node.replaceWith(createElement(icons[node.dataset.icon], { width: 18, height: 18, 'aria-hidden': 'true', 'stroke-width': 1.7 }));
}
const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
// Normalize the directory URL, including when a static host rewrites /books.
if (location.pathname.endsWith('/books')) history.replaceState(null, '', `${location.pathname}/${location.search}${location.hash}`);
const base = new URL('../', location.href);
const asset = file => new URL(`books/${file}`, base).href;
const STORAGE_KEY = 'folio.reading.v1';
const SESSION_KEY = 'folio.unlocked';
let records = {};
let filter = 'all';
let storageAvailable = true;
function storageWarning() {
  storageAvailable = false;
  $('storage-message').textContent = 'Browser storage is unavailable. You can still read, but your place may not be saved.';
  $('storage-message').hidden = false;
}
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  for (const book of books) {
    const record = saved?.[book.id];
    if (!record || !Number.isInteger(record.page) || record.page < 1 || !Number.isInteger(record.total) || record.total < record.page) continue;
    records[book.id] = { page: record.page, total: record.total, status: record.status === 'finished' ? 'finished' : 'reading', lastRead: Number.isFinite(record.lastRead) ? record.lastRead : 0 };
  }
} catch { storageWarning(); }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { storageWarning(); }
}
function percent(record) { return record ? (record.status === 'finished' ? 100 : Math.round(record.page / record.total * 100)) : 0; }
function progressText(record) { return record ? (record.status === 'finished' ? 'Finished · a chapter well spent' : `Page ${record.page} of ${record.total}`) : 'An unread adventure awaits'; }
function actionText(record) { return record ? (record.status === 'finished' ? 'Open book' : 'Continue reading') : 'Read book'; }
function renderLibrary() {
  const latest = [...books].sort((a, b) => (records[b.id]?.lastRead || 0) - (records[a.id]?.lastRead || 0))[0];
  $('library-count').textContent = `${String(books.length).padStart(2, '0')} ${books.length === 1 ? 'book' : 'books'} on the shelf`;
  $('collection-count').textContent = `${books.length} ${books.length === 1 ? 'book' : 'books'}`;
  $('featured').hidden = !latest;
  if (latest) {
    const r = records[latest.id];
    $('featured').innerHTML = `<div class="featured-art"><span class="art-number">THE FOLIO COLLECTION / 001</span><img class="cover" src="${escape(asset(latest.cover))}" alt="${escape(latest.title)} cover" width="400" height="600"><span class="art-caption">A classic worth coming back to.</span></div><div class="featured-copy"><p class="eyebrow">${r?.status === 'reading' ? 'PICK UP WHERE YOU LEFT OFF' : 'A GOOD PLACE TO BEGIN'}</p><div class="book-meta">${escape(latest.genre)} <span>·</span> ${escape(latest.year)}</div><h2>${escape(latest.title)}</h2><p class="author">by ${escape(latest.author)}</p><p class="book-description">${escape(latest.description)}</p><div class="reading-progress"><div class="progress-label"><span>${progressText(r)}</span><span>${percent(r)}%</span></div><progress max="100" value="${percent(r)}" aria-label="${escape(latest.title)} progress"></progress></div><div class="feature-actions"><button class="primary" data-read="${escape(latest.id)}">${actionText(r)}<i data-icon="arrow-right"></i></button>${r ? `<button class="text-button" data-reset="${escape(latest.id)}">Mark as unread</button>` : '<span class="feature-note">Open a book. Find your quiet.</span>'}</div></div>`;
  }
  const query = $('book-search').value.trim().toLocaleLowerCase();
  const visible = books.filter(book => (filter === 'all' || records[book.id]?.status === filter) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query));
  $('book-grid').innerHTML = visible.map(book => {
    const r = records[book.id];
    return `<article class="book-card"><button class="card-cover" data-read="${escape(book.id)}" aria-label="Open ${escape(book.title)}"><img src="${escape(asset(book.cover))}" alt="" width="400" height="600"></button><div class="card-body"><div class="book-meta"><span>${escape(book.genre)}</span><span class="status-pill ${r?.status || 'unread'}">${r ? (r.status === 'finished' ? 'Finished' : 'Reading') : 'To read'}</span></div><h3>${escape(book.title)}</h3><p class="author">${escape(book.author)}</p><div class="card-progress"><progress max="100" value="${percent(r)}" aria-label="${escape(book.title)} reading progress"></progress></div><div class="card-bottom"><span>${r ? `${percent(r)}% complete` : 'Not started'}</span><button class="text-button" data-read="${escape(book.id)}" aria-label="${actionText(r)}: ${escape(book.title)}">${r ? 'Open book' : 'Start reading'}<i data-icon="arrow-right"></i></button></div></div></article>`;
  }).join('');
  $('empty-state').hidden = visible.length > 0;
  const reading = books.filter(book => records[book.id]?.status === 'reading').length;
  const finished = books.filter(book => records[book.id]?.status === 'finished').length;
  $('reading-stats').innerHTML = `<div class="stat-row"><strong>${String(books.length).padStart(2, '0')}</strong><span>On the shelf</span></div><div class="stat-row"><strong>${String(reading).padStart(2, '0')}</strong><span>In progress</span></div><div class="stat-row"><strong>${String(finished).padStart(2, '0')}</strong><span>Books finished</span></div>`;
  decorate($('library'));
}
function unlock() {
  $('gate').hidden = true; $('library').hidden = false; $('lock-library').hidden = false;
  renderLibrary();
}
$('unlock-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('password').value !== 'kalimdor123') {
    $('password-error').textContent = 'That password isn’t quite right. Try again.';
    $('password-error').hidden = false;
    $('password').setAttribute('aria-invalid', 'true');
    $('password').setAttribute('aria-describedby', 'password-error');
    $('password').focus(); return;
  }
  $('password-error').hidden = true; $('password').removeAttribute('aria-invalid'); $('password').value = '';
  try { sessionStorage.setItem(SESSION_KEY, 'yes'); } catch { storageWarning(); }
  unlock(); $('library').querySelector('button').focus();
});
$('show-password').addEventListener('click', () => {
  const show = $('password').type === 'password';
  $('password').type = show ? 'text' : 'password';
  $('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  $('show-password').innerHTML = `<i data-icon="${show ? 'eye-off' : 'eye'}"></i>`; decorate($('show-password'));
});
$('lock-library').addEventListener('click', () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* The gate still locks in memory. */ }
  $('gate').hidden = false; $('library').hidden = true; $('lock-library').hidden = true;
  $('password').type = 'password'; $('show-password').setAttribute('aria-label', 'Show password');
  $('show-password').innerHTML = '<i data-icon="eye"></i>'; decorate($('show-password'));
  $('password').focus();
});
$('library').addEventListener('click', event => {
  const read = event.target.closest('[data-read]');
  if (read) openBook(books.find(book => book.id === read.dataset.read));
  const reset = event.target.closest('[data-reset]');
  if (reset) { delete records[reset.dataset.reset]; save(); renderLibrary(); }
  const choice = event.target.closest('[data-filter]');
  if (choice) {
    filter = choice.dataset.filter;
    for (const button of document.querySelectorAll('[data-filter]')) button.setAttribute('aria-pressed', String(button === choice));
    renderLibrary();
  }
});
$('book-search').addEventListener('input', renderLibrary);
$('clear-filters').addEventListener('click', () => { $('book-search').value = ''; document.querySelector('[data-filter="all"]').click(); });

let pdfjs, documentTask, pdf, activeBook, currentPage = 1, zoom = 1, renderTask, textTask;
let generation = 0, renderVersion = 0;
let readerOpener;
const reader = $('reader');
function setBusy(busy) {
  reader.setAttribute('aria-busy', String(busy));
  $('previous-page').disabled = busy || !pdf || currentPage <= 1;
  $('next-page').disabled = busy || !pdf || currentPage >= pdf.numPages;
  $('page-number').disabled = busy || !pdf;
  $('zoom-in').disabled = busy || !pdf || zoom >= 2;
  $('zoom-out').disabled = busy || !pdf || zoom <= 0.6;
  $('fit-page').disabled = busy || !pdf;
  $('finish-reading').disabled = busy || !pdf;
}
async function openBook(book) {
  if (!book) return;
  readerOpener = document.activeElement;
  activeBook = book; pdf = null; zoom = 1;
  const token = ++generation;
  $('reader-title').textContent = book.title; $('reader-author').textContent = book.author;
  $('pdf-page').hidden = true; $('reader-message').hidden = false; $('retry-book').hidden = true;
  $('reader-message').textContent = 'Opening your book…';
  $('reader-progress-label').textContent = 'Your next chapter is on its way'; $('reader-progress').value = 0;
  $('page-total').textContent = ''; $('page-number').value = 1; $('zoom-label').textContent = '100%';
  if (!reader.open) reader.showModal();
  document.body.style.overflow = 'hidden'; setBusy(true);
  try {
    pdfjs ||= await import('./pdf.js');
    if (token !== generation) return;
    documentTask = pdfjs.loadDocument(asset(book.file), new URL('pdfjs/', base).href);
    const loaded = await documentTask.promise;
    if (token !== generation) return;
    pdf = loaded;
    currentPage = Math.min(records[book.id]?.page || 1, pdf.numPages);
    $('page-number').max = pdf.numPages;
    $('page-total').textContent = `of ${pdf.numPages}`;
    await renderPage(currentPage);
  } catch (error) {
    if (token !== generation) return;
    console.error('Unable to open book', error);
    $('reader-message').textContent = 'This book couldn’t be opened. Check your connection and try again.';
    $('reader-message').hidden = false; $('retry-book').hidden = false; setBusy(false);
  }
}
async function renderPage(number, resetScroll = true) {
  if (!pdf) return;
  const token = generation, version = ++renderVersion;
  renderTask?.cancel(); textTask?.cancel();
  setBusy(true);
  $('reader-message').textContent = 'Preparing your page…'; $('reader-message').hidden = false;
  $('pdf-page').hidden = true;
  try {
    const page = await pdf.getPage(number);
    if (token !== generation || version !== renderVersion) return;
    const natural = page.getViewport({ scale: 1 });
    const available = Math.max(240, $('reader-scroll').clientWidth - (innerWidth < 600 ? 24 : 80));
    const scale = Math.min(available, 850) / natural.width * zoom;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const canvas = $('pdf-canvas');
    canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    $('pdf-page').style.width = `${viewport.width}px`; $('pdf-page').style.height = `${viewport.height}px`;
    $('pdf-page').style.setProperty('--scale-factor', scale);
    $('pdf-page').style.setProperty('--total-scale-factor', scale);
    renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    await renderTask.promise;
    if (token !== generation || version !== renderVersion) return;
    const textContent = await page.getTextContent();
    if (token !== generation || version !== renderVersion) return;
    $('pdf-text').replaceChildren();
    textTask = new pdfjs.TextLayer({ textContentSource: textContent, container: $('pdf-text'), viewport });
    await textTask.render();
    if (token !== generation || version !== renderVersion) return;
    currentPage = number;
    canvas.dataset.page = String(number); canvas.setAttribute('aria-label', `${activeBook.title}, page ${number} of ${pdf.numPages}`);
    $('page-number').value = number; $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
    const previous = records[activeBook.id];
    records[activeBook.id] = { page: number, total: pdf.numPages, status: previous?.status === 'finished' ? 'finished' : 'reading', lastRead: Date.now() }; save();
    updateReaderProgress();
    $('reader-message').hidden = true; $('pdf-page').hidden = false; $('retry-book').hidden = true;
    if (resetScroll) $('reader-scroll').scrollTo({ top: 0, left: 0 });
  } catch (error) {
    if (token !== generation || version !== renderVersion || error.name === 'RenderingCancelledException' || error.name === 'AbortException') return;
    console.error('Unable to render page', error);
    $('reader-message').textContent = 'This page couldn’t be displayed. Try opening the book again.';
    $('reader-message').hidden = false; $('retry-book').hidden = false;
  } finally { if (token === generation && version === renderVersion) setBusy(false); }
}
function updateReaderProgress() {
  const r = records[activeBook.id];
  $('reader-progress-label').textContent = `${!storageAvailable ? 'Progress not saved' : r.status === 'finished' ? 'Finished' : 'Your place is saved'} · ${percent(r)}%`;
  $('reader-progress').value = percent(r);
  $('finish-reading').textContent = r.status === 'finished' ? 'Mark as reading' : 'Mark as finished';
}
function closeReader() {
  ++generation; ++renderVersion; renderTask?.cancel(); textTask?.cancel();
  const task = documentTask; documentTask = null; pdf = null; activeBook = null;
  task?.destroy().catch(() => {});
  if (reader.open) reader.close();
  document.body.style.overflow = ''; renderLibrary();
  // Library rerender replaces book buttons, so find the corresponding action.
  const id = readerOpener?.closest('[data-read]')?.dataset.read;
  const opener = [...document.querySelectorAll('[data-read]')].find(node => node.dataset.read === id);
  (opener || $('lock-library')).focus();
}
$('close-reader').addEventListener('click', closeReader);
reader.addEventListener('cancel', event => { event.preventDefault(); closeReader(); });
$('retry-book').addEventListener('click', async () => {
  const book = activeBook, token = ++generation;
  renderTask?.cancel(); textTask?.cancel();
  await documentTask?.destroy();
  if (token === generation && reader.open) await openBook(book);
});
$('next-page').addEventListener('click', () => renderPage(Math.min(currentPage + 1, pdf.numPages)));
$('previous-page').addEventListener('click', () => renderPage(Math.max(currentPage - 1, 1)));
$('page-number').addEventListener('change', () => {
  const requested = Number($('page-number').value);
  if (!Number.isInteger(requested) || requested < 1 || requested > pdf.numPages) { $('page-number').value = currentPage; return; }
  renderPage(requested);
});
$('page-number').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('page-number').dispatchEvent(new Event('change')); } });
for (const [id, amount] of [['zoom-in', 0.2], ['zoom-out', -0.2], ['fit-page', 0]]) {
  $(id).addEventListener('click', () => { zoom = amount ? Math.max(0.6, Math.min(2, Math.round((zoom + amount) * 10) / 10)) : 1; renderPage(currentPage, false); });
}
$('finish-reading').addEventListener('click', () => {
  const r = records[activeBook.id]; if (!r) return;
  r.status = r.status === 'finished' ? 'reading' : 'finished'; save(); updateReaderProgress();
});
reader.addEventListener('keydown', event => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.altKey || event.metaKey || event.ctrlKey) return;
  const button = event.key === 'ArrowRight' ? $('next-page') : event.key === 'ArrowLeft' ? $('previous-page') : null;
  if (button && !button.disabled) { event.preventDefault(); button.click(); }
});
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (reader.open && pdf) renderPage(currentPage, false); }, 180); });
decorate();
try { if (sessionStorage.getItem(SESSION_KEY) === 'yes') unlock(); } catch { /* Default to the password gate. */ }
