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

async function readTiff(file) {
  const bytes = await file.arrayBuffer();
  const directory = new DataView(bytes);
  const little = directory.getUint16(0) === 0x4949;
  const start = directory.getUint32(4, little);
  const count = directory.getUint16(start, little);
  const next = start + 2 + count * 12;
  if (!count || next + 4 > bytes.byteLength) throw new Error('Invalid TIFF directory.');

  // The PDF uses one page. Ignore later directories and auxiliary metadata so
  // a circular linked list cannot hang the decoder.
  directory.setUint32(next, 0, little);
  const fieldSizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
  for (let entry = start + 2; entry < next; entry += 12) {
    const tag = directory.getUint16(entry, little);
    const type = directory.getUint16(entry + 2, little);
    const length = directory.getUint32(entry + 4, little) * (fieldSizes[type] || 0);
    if (length > 4 && directory.getUint32(entry + 8, little) + length > bytes.byteLength) {
      throw new Error('Incomplete TIFF field.');
    }
    if ([330, 34665, 34853, 50740, 61440].includes(tag)) directory.setUint16(entry, 0, little);
  }

  const { default: tiff } = await import('utif2');
  const [frame] = tiff.decode(bytes, { parseMN: false });
  const width = frame?.t256?.[0];
  const height = frame?.t257?.[0];
  const tiled = Boolean(frame?.t322 || frame?.t323 || frame?.t324);
  const blockWidth = tiled ? frame.t322?.[0] : width;
  const blockHeight = tiled ? frame.t323?.[0] : Math.min(frame?.t278?.[0] ?? height, height);
  const samples = frame?.t277?.[0] ?? 1;
  const depth = frame?.t258?.[0] ?? 1;
  if (![width, height, blockWidth, blockHeight, samples, depth].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Invalid TIFF image geometry.');
  }
  const planes = frame.t284?.[0] === 2 ? samples : 1;
  const blocks = Math.ceil(width / blockWidth) * Math.ceil(height / blockHeight);
  const offsets = tiled ? frame.t324 : frame.t273;
  const lengths = tiled ? frame.t325 : frame.t279;
  const raw = (frame.t259?.[0] ?? 1) === 1;
  if (offsets?.length !== blocks * planes || (lengths && lengths.length !== offsets.length)) {
    throw new Error('Invalid TIFF image blocks.');
  }
  const ycbcr = frame.t262?.[0] === 6;
  const [horizontal, vertical] = frame.t530 || [2, 2];
  if (ycbcr && ![horizontal, vertical].every(n => [1, 2, 4].includes(n))) {
    throw new Error('Invalid TIFF chroma subsampling.');
  }
  for (let i = 0; i < offsets.length; i++) {
    const rows = tiled ? blockHeight : Math.min(blockHeight, height - (i % blocks) * blockHeight);
    let minimum = 1;
    if (raw && ycbcr && planes === 1) {
      // Each clump stores several luminance samples but only two chroma samples.
      const clumps = Math.ceil(blockWidth / horizontal) * Math.ceil(rows / vertical);
      minimum = Math.ceil(clumps * (horizontal * vertical + 2) * depth / 8);
    } else if (raw && !ycbcr) {
      minimum = Math.ceil(blockWidth * depth * samples / planes / 8) * rows;
    }
    const length = lengths?.[i] ?? (raw && offsets.length === 1 ? minimum : 0);
    const offset = offsets[i];
    if (!Number.isSafeInteger(length) || !Number.isSafeInteger(offset) || offset < 0 ||
        length < minimum || offset + length > bytes.byteLength) {
      throw new Error('Incomplete TIFF image data.');
    }
  }
  return { bytes, frame, tiff, width, height, blockWidth, blockHeight, samples, depth,
    rawChroma: raw && ycbcr, offsets, horizontal, vertical };
}

function unpackChroma({ bytes, frame, width, height, blockWidth, blockHeight, samples, offsets, horizontal, vertical }) {
  if (samples !== 3 || !frame.t258?.every(bits => bits === 8) ||
      (frame.t266?.[0] ?? 1) !== 1 || (frame.t317?.[0] ?? 1) !== 1 ||
      frame.t339?.some(format => format !== 1) || frame.t34675) {
    throw new Error('Unsupported TIFF color encoding.');
  }
  const ratios = values => values?.map(([numerator, denominator]) => numerator / denominator);
  const [kr, kg, kb] = ratios(frame.t529) || [0.299, 0.587, 0.114];
  const [y0, y1, cb0, cb1, cr0, cr1] = ratios(frame.t532) || [0, 255, 128, 255, 128, 255];
  if (![kr, kg, kb, y0, y1, cb0, cb1, cr0, cr1].every(Number.isFinite) ||
      Math.min(kr, kg, kb) <= 0 || Math.abs(kr + kg + kb - 1) > 0.001 ||
      y1 <= y0 || cb1 <= cb0 || cr1 <= cr0) throw new Error('Invalid TIFF color parameters.');

  const input = new Uint8Array(bytes);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const blocksAcross = Math.ceil(width / blockWidth);
  const clumpsAcross = Math.ceil(blockWidth / horizontal);
  const lumaCount = horizontal * vertical;
  for (let y = 0; y < height; y++) {
    const blockRow = Math.floor(y / blockHeight) * blocksAcross;
    const localY = y % blockHeight;
    const clumpRow = Math.floor(localY / vertical) * clumpsAcross;
    const lumaRow = (localY % vertical) * horizontal;
    for (let x = 0; x < width; x++) {
      const localX = x % blockWidth;
      const block = offsets[blockRow + Math.floor(x / blockWidth)];
      const clump = block + (clumpRow + Math.floor(localX / horizontal)) * (lumaCount + 2);
      const luma = (input[clump + lumaRow + localX % horizontal] - y0) * 255 / (y1 - y0);
      const cb = (input[clump + lumaCount] - cb0) * 127 / (cb1 - cb0);
      const cr = (input[clump + lumaCount + 1] - cr0) * 127 / (cr1 - cr0);
      const red = luma + cr * (2 - 2 * kr);
      const blue = luma + cb * (2 - 2 * kb);
      const pixel = (y * width + x) * 4;
      pixels[pixel] = red;
      pixels[pixel + 1] = (luma - kr * red - kb * blue) / kg;
      pixels[pixel + 2] = blue;
      pixels[pixel + 3] = 255;
    }
  }
  return pixels;
}

async function decodeTiff(image) {
  const { bytes, frame, tiff, width, height, blockWidth, blockHeight, samples, depth } = image;
  const pixels = Math.max(width * height, blockWidth * blockHeight);
  if (pixels > 64_000_000 || depth > 32 || samples > 8 || pixels * depth * samples / 8 > 256 * MIB) {
    throw new Error('Oversized TIFF.');
  }
  // UTIF silently fills the page with zeroes for unknown compression methods.
  const supported = [1, 2, 3, 4, 5, 6, 7, 8, 9, 32767, 32773, 32809, 32946, 34316, 34676, 34713, 34892];
  if (!supported.includes(frame.t259?.[0] ?? 1) || frame.t284?.[0] === 2) {
    throw new Error('Unsupported TIFF encoding.');
  }
  let data;
  if (image.rawChroma) {
    data = unpackChroma(image);
  } else {
    if (frame.t278) frame.t278 = [Math.min(height, frame.t278[0])];
    tiff.decodeImage(bytes, frame);
    if (frame.t262?.[0] === 6) throw new Error('Unsupported TIFF chroma layout.');
    data = new Uint8ClampedArray(tiff.toRGBA8(frame).buffer);
  }
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

async function fallbackSource(file, signature, tiff) {
  if (tiff) return decodeTiff(tiff);
  if (/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
    return file.slice(0, file.size, 'image/svg+xml');
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
    const signature = String.fromCharCode(...new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    const tiff = /^(II\*\x00|MM\x00\*)/.test(signature) ? await readTiff(file) : null;
    if (tiff?.rawChroma) {
      // Some native TIFF decoders swap the red and blue channels for raw YCbCr.
      source = await decodeTiff(tiff);
    } else {
      try {
        decoded = await decodeBlob(source);
      } catch {
        source = await fallbackSource(file, signature, tiff);
      }
    }
    if (!decoded) decoded = await decodeBlob(source);
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

// Only reuse a baseline JFIF stream with no EXIF, color profile, embedded
// thumbnail, comments, or trailing data. Other JPEGs go through the canvas.
async function isPlainJpeg(blob, width, height) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const jfif = bytes.length >= 22 && view.getUint32(0) === 0xffd8ffe0 &&
    view.getUint16(4) === 16 && view.getUint32(6) === 0x4a464946 &&
    bytes[10] === 0 && view.getUint16(18) === 0;
  if (!jfif) return false;

  let frame = false;
  for (let offset = 20; offset + 4 <= bytes.length;) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);
    if (length < 2 || offset + 2 + length > bytes.length) return false;
    if (marker === 0xffc0) {
      if (length < 8 || bytes[offset + 4] !== 8 ||
          view.getUint16(offset + 5) !== height || view.getUint16(offset + 7) !== width ||
          ![1, 3].includes(bytes[offset + 9])) return false;
      frame = true;
    } else if (marker === 0xffda && frame) {
      // An entropy-coded scan can contain escaped FF bytes and restart markers.
      let next = bytes.indexOf(0xff, offset + 2 + length);
      while (next !== -1) {
        const code = bytes[next + 1];
        if (code === 0xd9) return next + 2 === bytes.length;
        if (code !== 0 && !(code >= 0xd0 && code <= 0xd7)) return false;
        next = bytes.indexOf(0xff, next + 2);
      }
      return false;
    } else if (![0xffc4, 0xffdb, 0xffdd].includes(marker)) {
      return false;
    }
    offset += 2 + length;
  }
  return false;
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
    const isJpeg = item.type === 'image/jpeg' || /\.(jpe?g|jfif)$/i.test(item.name);
    if (isJpeg && item.source.size < jpeg.size && canvas.width === item.width &&
        canvas.height === item.height && await isPlainJpeg(item.source, item.width, item.height)) {
      return item.source.slice(0, item.source.size, 'image/jpeg');
    }
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
