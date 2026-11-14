import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// Static HTML only: no adapter, no server rendering. `astro build` writes dist/.
export default defineConfig({
  output: 'static',
  site: 'https://about-spending.proappstore.online',
  vite: { plugins: [tailwindcss()] },
})
