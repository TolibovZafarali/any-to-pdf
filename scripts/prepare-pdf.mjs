import { cp, mkdir } from 'node:fs/promises';
// Self-host PDF.js resources so reading needs no third-party requests.
const destination = new URL('../public/pdfjs/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url), new URL(`${directory}/`, destination), { recursive: true });
}
