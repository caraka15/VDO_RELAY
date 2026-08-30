import fs from "node:fs";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

const localHttps = process.env.VITE_LOCAL_HTTPS === "1" ? {
  cert: fs.readFileSync(new URL("../data-local/local.crt", import.meta.url)),
  key: fs.readFileSync(new URL("../data-local/local.key", import.meta.url)),
} : undefined;

const localApiProxy = {
  target: "http://127.0.0.1:8081",
  changeOrigin: true,
};

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  // Local-only development: keep browser API calls same-origin while Go
  // serves the API on 8081. Production builds do not use this block.
  server: {
    host: "0.0.0.0",
    https: localHttps,
    proxy: {
      "/api": localApiProxy,
      "/healthz": localApiProxy,
    },
  },
  preview: {
    host: "0.0.0.0",
    https: localHttps,
    proxy: {
      "/api": localApiProxy,
      "/healthz": localApiProxy,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
