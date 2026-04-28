import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const openAiProxyTarget = env.VITE_OPENAI_PROXY_TARGET || 'http://127.0.0.1:8787';

  return {
    cacheDir: '.vite-temp',
    server: {
      port: 3001,
      strictPort: true,
      host: '127.0.0.1',
      https: true,
      proxy: {
        '/api/openai': {
          target: openAiProxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: () => '/openaiProxy',
        },
        '/api/pipedream': {
          target: openAiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [
      react(),
      basicSsl()
    ],
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
