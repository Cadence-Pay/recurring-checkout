import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // React is a peer dependency. The wallet kit is an optional peer and is loaded on demand.
  external: ['react', 'react-dom', /^@creit\.tech\//],
  // The default theme is plain CSS made of variables; consumers import it as `<package>/style.css`.
  onSuccess: async () => {
    await copyFile('src/style.css', 'dist/style.css');
  },
});
