import { defineConfig } from "@glaze/core/build";
import { cp, chmod, readdir, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import type { Plugin } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function chmodSpawnHelpers(prebuildsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(prebuildsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const platDir = join(prebuildsDir, entry);
    const helper = join(platDir, "spawn-helper");
    try {
      const s = await stat(helper);
      if (s.isFile()) await chmod(helper, 0o755);
    } catch {
      /* not all platforms have spawn-helper */
    }
  }
}

/**
 * node-pty ships native bindings + a spawn-helper binary that esbuild can't
 * bundle. Mark it external, then copy the entire package into the build output
 * as `node_modules/node-pty` so Node's resolver finds it at runtime.
 */
function copyNodePty(): Plugin {
  return {
    name: "copy-node-pty",
    setup(build) {
      build.onEnd(async () => {
        const outFile = build.initialOptions.outfile;
        const outDir = outFile ? dirname(outFile) : build.initialOptions.outdir;
        if (!outDir) return;
        const require = createRequire(import.meta.url);
        const ptyPkgPath = dirname(require.resolve("node-pty/package.json"));
        const dest = join(outDir, "node_modules", "node-pty");
        await cp(ptyPkgPath, dest, { recursive: true, force: true });
        await chmodSpawnHelpers(join(dest, "prebuilds"));
        console.log("[glaze] Copied node-pty into build output");
      });
    },
  };
}

function copyShellIntegration(): Plugin {
  return {
    name: "copy-shell-integration",
    setup(build) {
      build.onEnd(async () => {
        const outFile = build.initialOptions.outfile;
        const outDir = outFile ? dirname(outFile) : build.initialOptions.outdir;
        if (!outDir) return;
        const src = resolve(__dirname, "main", "services", "shell-integration");
        await cp(src, join(outDir, "shell-integration"), { recursive: true, force: true });
        console.log("[glaze] Copied shell-integration into build output");
      });
    },
  };
}

export default defineConfig({
  build: {
    external: ["node-pty"],
    plugins: [copyNodePty(), copyShellIntegration()],
  },
});
