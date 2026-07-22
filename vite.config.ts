import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ── Dev API proxy ───────────────────────────────────────────────────────────
//
// The deployed API's CORS allowlist contains ONLY the CloudFront origin, by
// design (security audit C3 replaced a wildcard `*`). A browser running at
// http://localhost:5173 therefore cannot call it directly: the preflight still
// returns 204, but echoes the CloudFront origin in Access-Control-Allow-Origin,
// so the browser discards the response and surfaces an opaque "CORS error".
//
// Rather than widen the production allowlist to trust localhost, dev traffic is
// proxied: the browser calls same-origin `/api/*`, Vite forwards it to API
// Gateway server-side, and CORS never enters the picture — no preflight is even
// sent. `.env.local` sets VITE_API_URL=/api so apiService builds relative URLs
// in dev; `.env` keeps the absolute prod URL, so production builds are
// completely unaffected.
//
// The target cannot be read back from VITE_API_URL here: `.env.local` overrides
// that to `/api`, which is precisely the value that must not be the target.
// Override with VITE_API_PROXY_TARGET if the API URL ever changes.
const API_PROXY_TARGET =
  process.env.VITE_API_PROXY_TARGET
  ?? 'https://jklolwtrlg.execute-api.ap-south-1.amazonaws.com/prod'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        // Rewrites the Host header to the API Gateway host. Without it API
        // Gateway receives Host: localhost:5173 and rejects the request.
        changeOrigin: true,
        // Strip the /api marker; the target already carries the /prod stage,
        // so /api/products is forwarded as /prod/products.
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
