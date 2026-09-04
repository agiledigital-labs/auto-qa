#!/usr/bin/env node
// Resolves env-var references in a project's QA context doc into a standalone
// file with real values substituted in, so secrets never have to pass through
// a subagent's prompt (or this tool's own console output).
//
// Usage: node scripts/resolve-context.mjs PROJECT_KEY OUTPUT_PATH
// Reads context/PROJECT_KEY.md, finds backtick-quoted SCREAMING_SNAKE_CASE
// tokens (the convention used when the context template references an env
// var, e.g. "env var `MOW_STAGING_QA_URL`"), and replaces each with its
// value from .env. Writes the resolved markdown to OUTPUT_PATH.
//
// Exits non-zero (stderr message, no partial file written) if the context
// file references an env var that isn't set in .env — that should stop the
// calling skill rather than hand the executor a broken/literal placeholder.
// Only variable *names* are ever printed to stdout/stderr; values are not.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fail(message) {
  console.error(`resolve-context: ${message}`);
  process.exit(1);
}

function main() {
  const [projectKey, outputPath] = process.argv.slice(2);
  if (!projectKey || !outputPath) {
    fail("usage: node scripts/resolve-context.mjs PROJECT_KEY OUTPUT_PATH");
  }

  const contextPath = path.join(projectRoot, "context", `${projectKey}.md`);
  if (!existsSync(contextPath)) {
    fail(`no context file found at context/${projectKey}.md`);
  }

  loadEnvFile(path.join(projectRoot, ".env"));

  const raw = readFileSync(contextPath, "utf8");
  const tokenRe = /`([A-Z][A-Z0-9_]*)`/g;
  const referenced = new Set();
  for (const match of raw.matchAll(tokenRe)) referenced.add(match[1]);

  const missing = [...referenced].filter((name) => !(name in process.env));
  if (missing.length > 0) {
    fail(
      `context/${projectKey}.md references env var(s) not set in .env: ${missing.join(
        ", "
      )} — add them to .env (see .env.example) before running QA`
    );
  }

  const resolved = raw.replace(tokenRe, (_match, name) => `\`${process.env[name]}\``);
  writeFileSync(outputPath, resolved, "utf8");

  const resolvedNames = [...referenced];
  console.log(
    resolvedNames.length > 0
      ? `resolve-context: wrote ${outputPath} (resolved ${resolvedNames.length} var(s): ${resolvedNames.join(", ")})`
      : `resolve-context: wrote ${outputPath} (no env var references found)`
  );
}

main();
