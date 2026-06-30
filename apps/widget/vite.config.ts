import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'SlotWiseWidget',
      formats: ['iife'],
      fileName: () => 'slotwise-widget.js',
    },
    rollupOptions: {
      output: {
        // Single self-contained file — no chunk splitting, this is embedded
        // via a single <script> tag on arbitrary third-party sites.
        inlineDynamicImports: true,
      },
    },
    cssCodeSplit: false,
    minify: 'esbuild',
  },
});
