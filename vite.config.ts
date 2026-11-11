import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The app holds a Bluesky session in localStorage, so the production build
// only allows scripts from its own origin, and only lets the page talk to the
// services it uses: if a dependency were ever compromised, it would have
// nowhere of its own to send the login to.
const BLUESKY = [
  // Sign-in, and the accounts hosted there before they moved to *.host.bsky.network.
  'https://bsky.social',
  // The servers Bluesky-hosted accounts live on.
  'https://*.bsky.network',
  // Images (cdn.bsky.app) and video (video.bsky.app, video.cdn.bsky.app).
  'https://*.bsky.app',
].join(' ')

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: shows the composer's thumbnails of images about to be uploaded.
  `img-src 'self' ${BLUESKY} data: blob:`,
  // hls.js plays video through MediaSource, which uses blob: URLs.
  `media-src ${BLUESKY} blob:`,
  // api.anthropic.com writes alt text, with the person's own key.
  `connect-src ${BLUESKY} https://api.anthropic.com`,
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
