// OCR for scanned PDF pages (roadmap 2.4b) — Tesseract running in the browser.
// The worker, the engine and the English data are bundled with the app (no CDN at runtime),
// so patient files never leave the computer. First use downloads ~7 MB once; the browser caches it.

import { createWorker } from 'tesseract.js';
import workerUrl from 'tesseract.js/dist/worker.min.js?url';
import coreUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url';
import langUrl from '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url';

const absolute = u => new URL(u, window.location.href).href;

/**
 * Starts one OCR worker (reuse it for every page, then call stop()).
 * Throws Error('ocr-setup') if the bundled files can't be found.
 */
export async function startOcr() {
  // Tesseract asks for "<langPath>/eng.traineddata.gz", so the bundled file must keep that name (see vite.config.js)
  if (!/\/eng\.traineddata\.gz$/.test(langUrl)) throw new Error('ocr-setup');
  const langPath = absolute(langUrl).replace(/\/eng\.traineddata\.gz$/, '');
  let worker;
  try {
    worker = await createWorker('eng', 1, {   // 1 = LSTM engine, matches the bundled core
      workerPath: absolute(workerUrl),
      corePath: absolute(coreUrl),
      langPath,
      workerBlobURL: false,
    });
  } catch {
    throw new Error('ocr-setup');
  }
  return {
    /**
     * Reads one image (Blob / canvas) → [{ text, conf, x0, y0, x1, y1 }] in image pixels (y grows downwards).
     */
    async words(image) {
      const { data } = await worker.recognize(image, {}, { blocks: true, text: false });
      const out = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {
            for (const w of line.words ?? []) {
              if (!w.text?.trim()) continue;
              out.push({ text: w.text, conf: w.confidence ?? 0, ...w.bbox });
            }
          }
        }
      }
      return out;
    },
    stop: () => worker.terminate(),
  };
}
