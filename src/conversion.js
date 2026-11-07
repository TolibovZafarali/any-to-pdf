const MIB = 1024 * 1024;
const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };
const QUALITY = { edge: 8192, pixels: 16_000_000, jpeg: 0.94 };
const BALANCED = { edge: 2560, pixels: 6_000_000, jpeg: 0.8 };
const COMPACT = { edge: 1600, pixels: 2_560_000, jpeg: 0.65 };
let nextId = 1;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('There is not enough memory to process this image.');
  return { canvas, context };
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode this image.'));
    }, type, quality);
  });
}

async function decodeBlob(blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image.');
    return { image, url };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function releaseImage({ image, url }) {
  image.removeAttribute('src');
  URL.revokeObjectURL(url);
}

function drawImage(image, maxEdge, maxPixels) {
  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  const { canvas, context } = makeCanvas(
    Math.max(1, Math.round(width * scale)),
    Math.max(1, Math.round(height * scale)),
  );
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeTiff(file) {
  const { default: tiff } = await import('utif2');
  const bytes = await file.arrayBuffer();
  const [frame] = tiff.decode(bytes);
  const width = frame?.t256?.[0];
  const height = frame?.t257?.[0];
  if (!width || !height || width * height > 64_000_000) {
    throw new Error('Invalid or oversized TIFF.');
  }
  tiff.decodeImage(bytes, frame);
  const data = new Uint8ClampedArray(tiff.toRGBA8(frame).buffer);
  const { canvas, context } = makeCanvas(width, height);
  let oriented;
  try {
    context.putImageData(new ImageData(data, width, height), 0, 0);
    const orientation = frame.t274?.[0] || 1;
    const transforms = {
      2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height],
      4: [1, 0, 0, -1, 0, height], 5: [0, 1, 1, 0, 0, 0],
      6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width],
      8: [0, -1, 1, 0, 0, width],
    };
    if (!transforms[orientation]) return await canvasBlob(canvas, 'image/png');
    const swap = orientation >= 5;
    oriented = makeCanvas(swap ? height : width, swap ? width : height);
    oriented.context.setTransform(...transforms[orientation]);
    oriented.context.drawImage(canvas, 0, 0);
    return await canvasBlob(oriented.canvas, 'image/png');
  } finally {
    canvas.width = 1;
    if (oriented) oriented.canvas.width = 1;
  }
}

async function fallbackSource(file) {
  const signature = String.fromCharCode(...new Uint8Array(await file.slice(0, 32).arrayBuffer()));
  if (/^(II\*\x00|MM\x00\*)/.test(signature) || /\.tiff?$/i.test(file.name) || file.type === 'image/tiff') {
    return decodeTiff(file);
  }
  if (/ftyp(heic|heix|hevc|hevx|mif1|msf1|avif|avis)/.test(signature) ||
      /\.(heic|heif|avif)$/i.test(file.name) || /image\/(heic|heif|avif)/.test(file.type)) {
    const { heicTo } = await import('heic-to/csp');
    return heicTo({ blob: file, type: 'image/png' });
  }
  throw new Error('Unrecognized image.');
}

export async function prepareImage(file) {
  let source = file;
  let decoded;
  try {
    try {
      decoded = await decodeBlob(source);
    } catch {
      source = await fallbackSource(file);
      decoded = await decodeBlob(source);
    }
  } catch {
    throw new Error('Could not open this image. Check the file or try saving it as JPG or PNG.');
  }

  const { naturalWidth: width, naturalHeight: height } = decoded.image;
  let canvas;
  try {
    canvas = drawImage(decoded.image, 320, 320 * 320);
    const thumbnail = URL.createObjectURL(await canvasBlob(canvas, 'image/jpeg', 0.82));
    return { id: String(nextId++), name: file.name || 'Pasted image', width, height, size: file.size, thumbnail, source, type: file.type };
  } finally {
    if (canvas) canvas.width = 1;
    releaseImage(decoded);
  }
}

function encodingPreset(item, mode, total) {
  if (mode === 'small') return COMPACT;
  if (mode === 'quality') return QUALITY;
  if (item.size >= 2 * MIB || total >= 8 * MIB || item.width * item.height >= 10_000_000) {
    return BALANCED;
  }
  return QUALITY;
}

async function encodeForPdf(item, preset) {
  const decoded = await decodeBlob(item.source);
  let canvas;
  try {
    canvas = drawImage(decoded.image, preset.edge, preset.pixels);
    const isGraphic = /png|gif|svg|bmp|icon|tiff/.test(item.type) ||
      /\.(png|gif|svg|bmp|ico|tiff?)$/i.test(item.name);
    if (isGraphic && preset === QUALITY) return await canvasBlob(canvas, 'image/png');

    const jpeg = await canvasBlob(canvas, 'image/jpeg', preset.jpeg);
    if (isGraphic && jpeg.size > item.size) {
      const png = await canvasBlob(canvas, 'image/png');
      if (png.size <= jpeg.size) return png;
    }
    return jpeg;
  } finally {
    if (canvas) canvas.width = 1;
    releaseImage(decoded);
  }
}

function pageDimensions(item, pageSize) {
  const paper = PAPER[pageSize];
  if (paper) return item.width > item.height ? [paper[1], paper[0]] : paper;
  // A CSS pixel is 0.75 PDF points. Standard PDF pages allow up to 14,400 points.
  const scale = Math.min(0.75, 14400 / Math.max(item.width, item.height));
  return [item.width * scale, item.height * scale];
}

export async function exportPdf(items, { pageSize = 'fit', compression = 'auto' } = {}, onProgress) {
  if (!items.length) throw new Error('Add at least one image to create a PDF.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const total = items.reduce((sum, item) => sum + item.size, 0);
  for (const [index, item] of items.entries()) {
    const preset = encodingPreset(item, compression, total);
    const blob = await encodeForPdf(item, preset);
    const bytes = await blob.arrayBuffer();
    const image = blob.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const [pageWidth, pageHeight] = pageDimensions(item, pageSize);
    const page = pdf.addPage([pageWidth, pageHeight]);
    const scale = Math.min(pageWidth / item.width, pageHeight / item.height);
    const width = item.width * scale;
    const height = item.height * scale;
    page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
    await image.embed();
    onProgress?.(index + 1, items.length);
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
