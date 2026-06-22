import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/SalaryCalc/',
  plugins: [react()],
  server: {
    proxy: {
      '/api-nbu': {
        target: 'https://bank.gov.ua',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-nbu/, ''),
      }
    }
  }
})
