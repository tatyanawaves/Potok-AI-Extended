import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HTTPS comes from basicSsl() below. `https: true` used to mean "with a
      // self-signed cert" but now expects an options object, so it was both a
      // type error and a no-op.
    },
    plugins: [
      react(),
      basicSsl()
    ],
    build: {
      rollupOptions: {
        output: {
          // Libraries that change only when they are upgraded are kept apart
          // from application code, so a deploy does not invalidate them in
          // everyone's cache. They are needed at startup, so this does not
          // shrink the first load — the map and document parsing are split
          // out by dynamic import instead, which does.
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            react: ['react', 'react-dom', 'react-router-dom']
          }
        }
      }
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
