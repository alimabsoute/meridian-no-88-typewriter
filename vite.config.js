import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { comingSoonPreviewsPlugin } from './scripts/copy-coming-soon-previews.mjs';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), comingSoonPreviewsPlugin()],
  test: {
    // Geometry sweeps, dense-paper persistence, and the authored room raster
    // are intentionally CPU-heavy. Serial files keep their wall-clock guards
    // meaningful on laptops and shared CI runners instead of timing out from
    // worker contention.
    fileParallelism: false,
    maxWorkers: 1,
  },
  build: {
    target: 'esnext',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
