import { rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicRoot = resolve(projectRoot, "dist");
const previousRoot = resolve(projectRoot, "dist.previous");
const stagingRoot = resolve(projectRoot, "dist.staging");

await rm(stagingRoot, { force: true, recursive: true });

try {
  await build({
    root: projectRoot,
    configFile: resolve(projectRoot, "vite.config.ts"),
    build: {
      outDir: stagingRoot,
      emptyOutDir: true,
    },
  });

  await rm(previousRoot, { force: true, recursive: true });

  let movedCurrentBuild = false;
  try {
    await rename(publicRoot, previousRoot);
    movedCurrentBuild = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }

  try {
    await rename(stagingRoot, publicRoot);
  } catch (error) {
    if (movedCurrentBuild) await rename(previousRoot, publicRoot);
    throw error;
  }
} catch (error) {
  await rm(stagingRoot, { force: true, recursive: true });
  throw error;
}
