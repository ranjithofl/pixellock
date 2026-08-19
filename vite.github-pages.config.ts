import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];

export default defineConfig({
  root: "github-pages",
  base: repositoryName ? `/${repositoryName}/` : "/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
