import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wgslVitePlugin } from 'vgpu/client';

// COOP/COEP enable cross-origin isolation (needed later for SharedArrayBuffer / wasm threads).
const crossOriginIsolation = {
  name: 'cross-origin-isolation',
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  },
};

export default defineConfig({
  // GitHub Pages serves the repo under /<repo>/: `npm run build:pages` sets TJM_BASE.
  base: process.env.TJM_BASE ?? '/',
  plugins: [react(), crossOriginIsolation, wgslVitePlugin({ minify: true })], // .wgsl modules for the vgpu black hole
  // No backend: /api is answered inside the page (src/local/server.js).
  server: { port: 5191, strictPort: true },
  worker: { format: 'es' },
});
