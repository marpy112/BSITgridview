import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendOrigin = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest, request) => {
            // Preserve the Worker's origin checks across the local dev proxy.
            // Only translate an Origin that matches the requesting Vite host.
            const origin = request.headers.origin;
            if (!origin) return;
            try {
              if (new URL(origin).host === request.headers.host) {
                proxyRequest.setHeader('Origin', backendOrigin);
              }
            } catch {
              // Leave malformed or unrelated origins for the Worker to reject.
            }
          });
        },
      },
    },
  },
});
