import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "ocr-engine": ["@gutenye/ocr-browser"],
          "onnx-runtime": ["onnxruntime-web"],
          "charts": ["recharts"],
          "three": ["three", "three-stdlib"],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "masked-icon.svg",
        "pwa-192x192.png",
        "pwa-512x512.png"
      ],
      manifest: {
        name: "Clean Cards - Trading Card Manager",
        short_name: "Clean Cards",
        description: "AI-powered trading card scanner and collection manager. Scan, identify, and price your cards instantly.",
        theme_color: "#000000",
        background_color: "#000000",
        display: "standalone",
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/?source=pwa",
        lang: "en",
        dir: "ltr",
        categories: ["utilities", "lifestyle", "entertainment"],
        prefer_related_applications: false,
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        screenshots: [
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", label: "Clean Cards Home" }
        ],
        shortcuts: [
          {
            name: "Scan Card",
            short_name: "Scan",
            description: "Scan a new trading card",
            url: "/scan?source=shortcut",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "My Collection",
            short_name: "Collection",
            description: "View your card collection",
            url: "/collections?source=shortcut",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Dashboard",
            short_name: "Dashboard",
            description: "View collection stats",
            url: "/dashboard?source=shortcut",
            icons: [{ src: "/pwa-192x192.png", sizes: "192x192" }]
          }
        ],
        display_override: ["standalone", "minimal-ui"],
        handle_links: "preferred",
        launch_handler: {
          client_mode: ["navigate-existing", "auto"]
        }
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,json,webmanifest,woff2}"],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//, /\/supabase\//],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }: { request: Request; url: URL }) => request.method === "GET" && url.pathname.startsWith("/assets/"),
            handler: "CacheFirst",
            options: {
              cacheName: "assets-v1",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            urlPattern: ({ request }) => request.method === "GET" && request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images-v1",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 }
            }
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: "module"
      }
    } as any),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
