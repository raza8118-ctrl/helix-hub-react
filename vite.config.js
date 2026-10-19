import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // OCR (File Tools → PDF → Excel): tesseract.js asks for "<folder>/eng.traineddata.gz", so that one
        // bundled file keeps its exact name instead of getting a hash. Everything else is unchanged.
        assetFileNames: info => {
          const name = info.names?.[0] ?? info.name ?? '';
          return name.endsWith('.traineddata.gz') ? 'tessdata/[name][extname]' : 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
})
