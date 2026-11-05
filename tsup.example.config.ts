import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

// Bundles the example page into one script for the browser, with React and the Stellar SDK inside.
export default defineConfig({
  entry: { main: 'examples/basic/main.tsx' },
  format: ['iife'],
  platform: 'browser',
  target: 'es2022',
  outDir: 'examples/basic/dist',
  noExternal: [/.*/],
  // The wallet kit is optional and loaded on demand, so the page works without it installed.
  external: [/^@creit\.tech\//],
  minify: true,
  dts: false,
  clean: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  onSuccess: async () => {
    await copyFile('src/style.css', 'examples/basic/dist/style.css');
  },
});
