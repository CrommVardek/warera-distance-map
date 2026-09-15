import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves project pages from /<repo-name>/, but local dev
  // should stay at the root.
  base: process.env.GITHUB_ACTIONS ? '/warera-distance-map/' : '/',
  plugins: [react()],
  ssr: {noExternal: ['maplibre-gl']}
})
