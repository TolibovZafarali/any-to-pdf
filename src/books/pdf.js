import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
GlobalWorkerOptions.workerSrc = workerUrl;
export { TextLayer };
export function loadDocument(url, assets) {
  return getDocument({ url, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, isEvalSupported: false });
}
