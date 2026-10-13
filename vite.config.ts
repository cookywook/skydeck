import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The app holds a Bluesky session in localStorage, so the production build
// only allows scripts from its own origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src https: data:",
  "media-src https:",
  "connect-src https:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function csp(): Plugin {
  return {
    name: 'skydeck-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      ),
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/skydeck/' : '/',
  plugins: [react(), csp()],
  server: { port: 5199, strictPort: true },
  test: { environment: 'node' },
}))
