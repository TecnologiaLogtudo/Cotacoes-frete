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
      port: 5173,
    },
  }
})
