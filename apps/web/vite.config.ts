import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const envDirectory = resolve(import.meta.dirname, '../..');
  const env = loadEnv(mode, envDirectory, '');

  return {
    envDir: envDirectory,
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-realtime';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('react-dom') || id.includes('react-router') || /node_modules[\\/]react[\\/]/.test(id)) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env.VITE_DEV_SOCKET_TARGET ?? env.VITE_DEV_API_TARGET ?? 'http://localhost:4000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
    test: {
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      css: true,
      coverage: {
        reporter: ['text', 'html'],
      },
    },
  };
});
