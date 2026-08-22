import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Guards against shipping a new required env var without documenting it in
// .env.example — a common source of "works on my machine" breakage. Every
// process.env.X referenced in app code must appear in .env.example, except for
// platform-injected / runtime-only vars listed below.
const ALLOW_LIST = new Set([
  "NODE_ENV",
  "VERCEL",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "FIRESTORE_EMULATOR_HOST",
  "PORT",
  "HOST",
  "TOKEN_STORE_PATH",
  "PENDING_LINKS_CACHE_PATH",
]);

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "app", "scripts"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function referencedEnvVars(): Set<string> {
  const found = new Set<string>();
  const patterns = [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, /process\.env\[["']([A-Za-z_][A-Za-z0-9_]*)["']\]/g];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) found.add(match[1]);
      }
    }
  }
  return found;
}

function documentedEnvVars(): Set<string> {
  const documented = new Set<string>();
  const text = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim());
    if (match) documented.add(match[1]);
  }
  return documented;
}

test("every referenced env var is documented in .env.example", () => {
  const documented = documentedEnvVars();
  const referenced = referencedEnvVars();
  const undocumented = [...referenced].filter((name) => !documented.has(name) && !ALLOW_LIST.has(name)).sort();
  assert.deepEqual(
    undocumented,
    [],
    `These env vars are used in code but missing from .env.example (add them there, or to the ALLOW_LIST if platform-injected): ${undocumented.join(", ")}`,
  );
});
