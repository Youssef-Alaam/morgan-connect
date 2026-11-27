import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser talks to the backend on the same origin; in dev and preview `/api` is passed through.
const api = { '/api': `http://localhost:${process.env['API_PORT'] ?? '3000'}` };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
});
