import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const browserNodeShim = path.resolve(__dirname, "./src/lib/browser-node-empty.ts");

  return {
    server: {
      host: "::",
      port: 8080,
    },
    build: {
      // The scanner intentionally ships a local OCR/WASM engine. Keep warnings useful
      // without flagging that expected scanner payload on every production build.
      chunkSizeWarningLimit: 12_000,
      rollupOptions: {
        output: {
          manualChunks: {
            "ocr-engine": ["@gutenye/ocr-browser"],
            "onnx-runtime": ["onnxruntime-web"],
            "charts": ["recharts"],
            "three": ["three", "three-stdlib"],
            "excel-export": ["exceljs", "jszip"],
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ["@techstark/opencv-js"],
    },
    plugins: [
      react(),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        fs: browserNodeShim,
        path: browserNodeShim,
        crypto: browserNodeShim,
      },
    },
  };
});
