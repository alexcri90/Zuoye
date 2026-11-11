/**
 * Reads a PDF in the browser: the text layer of each page plus the page
 * rendered as a small JPEG (dialogues and some exercises exist only as
 * pictures). pdf.js and all its assets are loaded from the app's own address,
 * and only when a lesson is being added.
 */
import { canvasToJpeg, type Jpeg } from './image.ts';

export const MAX_PAGES = 60;
const JPEG_QUALITY = 0.72;

export interface PdfPage {
  number: number;
  text: string;
  image: Jpeg | null;
}

export interface PdfContent {
  pages: PdfPage[];
  /** Pages in the file; more than `pages.length` when the file was cut at MAX_PAGES. */
  totalPages: number;
}

const assetUrl = (dir: string): string => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export async function readPdf(
  bytes: Uint8Array,
  options: { width?: number; onPage?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<PdfContent> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
    iccUrl: assetUrl('iccs'),
    enableXfa: false,
    verbosity: 0,
  });

  try {
    const doc = await task.promise;
    const count = Math.min(doc.numPages, MAX_PAGES);
    const width = options.width ?? 1000;
    const pages: PdfPage[] = [];

    for (let number = 1; number <= count; number++) {
      options.signal?.throwIfAborted();
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
        .trim();

      let image: Jpeg | null = null;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, width / natural.width) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext('2d');
      if (canvasContext) {
        try {
          await page.render({ canvas, canvasContext, viewport }).promise;
          image = await canvasToJpeg(canvas, JPEG_QUALITY);
        } catch {
          image = null; // the text of the page is still used
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      pages.push({ number, text, image });
      options.onPage?.(number, count);
    }
    return { pages, totalPages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
