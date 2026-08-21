import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
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
// The target cannot be read back from VITE_API_URL here: `.env.development.local`
// overrides that to `/api`, which is precisely the value that must not be the target.
// Set VITE_API_PROXY_TARGET in `.env.development.local` to point at another stack.
//
// It must be read with loadEnv, NOT process.env: Vite does not copy `.env` files
// into process.env, so a value set there is invisible to this config file. Before
// this, VITE_API_PROXY_TARGET only worked as a real shell variable — which is why
// local development had no practical way to stop targeting production.
//
// The DEFAULT is now the dev API, not prod. This proxy runs only under `npm run
// dev`; production builds use the absolute VITE_API_URL from `.env` and never
// touch it. So the safe default is the empty dev stack: reaching production from
// localhost should take a deliberate override, not an omission.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const API_PROXY_TARGET =
    process.env.VITE_API_PROXY_TARGET
    ?? env.VITE_API_PROXY_TARGET
    ?? 'https://gkat4p5bje.execute-api.ap-south-1.amazonaws.com/prod'  // BiztrackStack-dev

  return {
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
          rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
      },
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})
