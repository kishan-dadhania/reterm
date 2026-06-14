import fs from "fs/promises";
import path from "path";
import { ProjectEntry } from "./types.js";
import { loadSettings, getRecentFolders } from "./history-store.js";

let cachedIndex: ProjectEntry[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

export function invalidateProjectCache(): void {
  cachedIndex = null;
  cacheTimestamp = 0;
}

const MAX_DEPTH = 5;
const MAX_RESULTS_PER_ROOT = 500;
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".Trash",
  ".cache",
  "Library",
  ".git",
  "vendor",
  "dist",
  "build",
  ".gradle",
  ".m2",
]);

async function discoverGitProjectsInRoot(root: string): Promise<string[]> {
  const results: string[] = [];
  let count = 0;

  async function walk(dir: string, depth: number) {
    if (count >= MAX_RESULTS_PER_ROOT) return;
    if (depth > MAX_DEPTH) return;

    let files;
    try {
      files = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Ignore errors (permission denied, missing folder, etc.)
      return;
    }

    // Check if .git directory exists inside current dir
    const hasGit = files.some(
      (f) => f.isDirectory() && f.name === ".git"
    );
    if (hasGit) {
      results.push(dir);
      count++;
      return; // Stop recursion under this folder if it's already a git repository
    }

    for (const file of files) {
      if (
        file.isDirectory() &&
        !file.name.startsWith(".") &&
        !SKIP_DIRECTORIES.has(file.name)
      ) {
        await walk(path.join(dir, file.name), depth + 1);
        if (count >= MAX_RESULTS_PER_ROOT) return;
      }
    }
  }

  const resolvedRoot = path.resolve(root);
  await walk(resolvedRoot, 1);
  return results;
}

export async function discoverGitProjects(roots: string[]): Promise<string[]> {
  const allResults = new Set<string>();
  for (const root of roots) {
    try {
      const projects = await discoverGitProjectsInRoot(root);
      for (const p of projects) {
        allResults.add(p);
      }
    } catch {
      // ignore root scan errors
    }
  }
  return Array.from(allResults);
}

export async function listMountSubfolders(roots: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const root of roots) {
    try {
      const resolvedRoot = path.resolve(root);
      const files = await fs.readdir(resolvedRoot, { withFileTypes: true });
      for (const file of files) {
        if (
          file.isDirectory() &&
          !file.name.startsWith(".") &&
          !SKIP_DIRECTORIES.has(file.name)
        ) {
          results.push(path.join(resolvedRoot, file.name));
        }
      }
    } catch {
      // ignore
    }
  }
  return results;
}

export async function getProjectIndex(forceRefresh = false): Promise<ProjectEntry[]> {
  const now = Date.now();
  if (!forceRefresh && cachedIndex && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedIndex;
  }

  const settings = await loadSettings();
  const gitRoots = settings.gitDiscoveryRoots || [];
  const mountRoots = settings.mountRoots || [];

  // Run discoveries in parallel
  const [gitPaths, mountPaths, recentPaths] = await Promise.all([
    discoverGitProjects(gitRoots),
    listMountSubfolders(mountRoots),
    getRecentFolders(100),
  ]);

  const mergedMap = new Map<string, ProjectEntry>();

  // 1. Recent (lowest precedence for type badge)
  for (const p of recentPaths) {
    const resolved = path.resolve(p);
    mergedMap.set(resolved, {
      path: resolved,
      type: "recent",
      name: path.basename(resolved) || resolved,
    });
  }

  // 2. Git
  for (const p of gitPaths) {
    const resolved = path.resolve(p);
    mergedMap.set(resolved, {
      path: resolved,
      type: "git",
      name: path.basename(resolved) || resolved,
    });
  }

  // 3. Mount (highest precedence)
  for (const p of mountPaths) {
    const resolved = path.resolve(p);
    mergedMap.set(resolved, {
      path: resolved,
      type: "mount",
      name: path.basename(resolved) || resolved,
    });
  }

  const result = Array.from(mergedMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  cachedIndex = result;
  cacheTimestamp = Date.now();

  return result;
}
