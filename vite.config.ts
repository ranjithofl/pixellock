import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { securityHeaders } from "./config/security-headers.mjs";

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    cors: false,
    headers: securityHeaders({ development: true }),
    fs: { strict: true },
  },
  preview: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: true,
    allowedHosts: ["localhost", "127.0.0.1"],
    headers: securityHeaders(),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
