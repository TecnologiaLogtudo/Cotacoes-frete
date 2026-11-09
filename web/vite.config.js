import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function normalizeBasePath(raw) {
  const value = (raw || '/cotacoes').trim()
  if (!value || value === '/') return '/'

  const withLeading = value.startsWith('/') ? value : `/${value}`
  const withoutTrailing = withLeading.replace(/\/+$/, '')
  return `${withoutTrailing}/`
}

export default defineConfig(() => {
  const base = normalizeBasePath(process.env.BASE_PATH)

  return {
    base,
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5180,
      strictPort: true,
      proxy: {
        '^(/cotacoes)?/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cotacoes/, ''),
        },
        '^(/cotacoes)?/health': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cotacoes/, ''),
        },
        '^(/cotacoes)?/manual-de-uso': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cotacoes/, ''),
        },
      },
    },
  }
})
