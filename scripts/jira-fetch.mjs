#!/usr/bin/env node
// Fetches a Jira Cloud ticket and extracts its description and QA statement.
//
// Usage: node scripts/jira-fetch.mjs TICKET-KEY
// Prints one JSON object to stdout: { key, projectKey, summary, description, qaStatement }
// Exits non-zero (with a message on stderr) on auth failure, 404, or no QA
// statement found — any of those should stop the calling skill before it
// bothers spawning the linter.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { adfToMarkdown } from "./adf-to-md.mjs";

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
  console.error(`jira-fetch: ${message}`);
  process.exit(1);
}

// Jira custom fields come back either as a plain string (short text fields)
// or as an ADF document (paragraph/rich-text fields) — normalize both to
// trimmed Markdown text.
function extractFieldMarkdown(fieldValue) {
  if (typeof fieldValue === "string") return fieldValue.trim();
  if (fieldValue && typeof fieldValue === "object") return adfToMarkdown(fieldValue);
  return "";
}

function splitAtHeading(markdown, headingText) {
  const lines = markdown.split("\n");
  const headingRe = /^(#{1,6})\s+(.*)$/;
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === headingText.trim().toLowerCase()) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return { before: markdown, section: null };

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }

  const before = [...lines.slice(0, startIdx), ...lines.slice(endIdx)].join("\n").trim();
  const section = lines.slice(startIdx + 1, endIdx).join("\n").trim();
  return { before, section };
}

async function main() {
  const ticketKey = process.argv[2];
  if (!ticketKey) fail("usage: node scripts/jira-fetch.mjs TICKET-KEY");

  loadEnvFile(path.join(projectRoot, ".env"));

  const configPath = path.join(projectRoot, "config", "jira.config.json");
  if (!existsSync(configPath)) fail(`missing config file: ${configPath}`);
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  const email = process.env[config.emailEnvVar];
  const apiToken = process.env[config.apiTokenEnvVar];
  if (!email || !apiToken) {
    fail(
      `missing Jira credentials — set ${config.emailEnvVar} and ${config.apiTokenEnvVar} in .env (see .env.example)`
    );
  }
  if (!config.domain || config.domain === "yourcompany.atlassian.net") {
    fail(`config/jira.config.json "domain" is still the placeholder — set your real Jira Cloud domain`);
  }

  const projectKey = ticketKey.split("-")[0];
  const projectConfig = config.projects?.[projectKey];
  if (!projectConfig) {
    fail(
      `no project config for "${projectKey}" in config/jira.config.json — add a "${projectKey}" entry under "projects"`
    );
  }

  const fieldsParam = ["summary", "description"];
  if (projectConfig.descriptionCustomField) fieldsParam.push(projectConfig.descriptionCustomField);
  if (projectConfig.qaStatementCustomField) fieldsParam.push(projectConfig.qaStatementCustomField);

  const url = `https://${config.domain}/rest/api/3/issue/${encodeURIComponent(
    ticketKey
  )}?fields=${fieldsParam.join(",")}`;

  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");
  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    fail(`network error contacting Jira: ${err.message}`);
  }

  if (res.status === 401 || res.status === 403) {
    fail(`Jira auth failed (HTTP ${res.status}) — check ${config.emailEnvVar}/${config.apiTokenEnvVar} in .env`);
  }
  if (res.status === 404) {
    fail(`ticket "${ticketKey}" not found (HTTP 404)`);
  }
  if (!res.ok) {
    fail(`Jira API error (HTTP ${res.status}): ${await res.text()}`);
  }

  const issue = await res.json();
  const summary = issue.fields?.summary ?? "";

  // Some projects keep the "real" description in a custom field (e.g. a
  // structured "Improvement Description" field) rather than Jira's built-in
  // description field. Prefer the configured custom field when it has content,
  // falling back to the built-in field otherwise.
  let descriptionMarkdown = "";
  if (projectConfig.descriptionCustomField) {
    descriptionMarkdown = extractFieldMarkdown(issue.fields?.[projectConfig.descriptionCustomField]);
  }
  if (!descriptionMarkdown) {
    descriptionMarkdown = adfToMarkdown(issue.fields?.description);
  }

  let description = descriptionMarkdown;
  let qaStatement = "";

  if (projectConfig.qaStatementCustomField) {
    qaStatement = extractFieldMarkdown(issue.fields?.[projectConfig.qaStatementCustomField]);
    if (!qaStatement && projectConfig.qaStatementHeading) {
      // Fall back to the heading in the description if the custom field was empty.
      const { before, section } = splitAtHeading(descriptionMarkdown, projectConfig.qaStatementHeading);
      if (section) {
        description = before;
        qaStatement = section;
      }
    }
  } else if (projectConfig.qaStatementHeading) {
    const { before, section } = splitAtHeading(descriptionMarkdown, projectConfig.qaStatementHeading);
    description = before;
    qaStatement = section ?? "";
  }

  if (!qaStatement) {
    fail(
      `no QA statement found for ${ticketKey} — checked ${
        projectConfig.qaStatementCustomField ? `custom field "${projectConfig.qaStatementCustomField}"` : "no custom field"
      }${projectConfig.qaStatementHeading ? ` and description heading "${projectConfig.qaStatementHeading}"` : ""}`
    );
  }

  process.stdout.write(
    JSON.stringify({ key: ticketKey, projectKey, summary, description, qaStatement }, null, 2) + "\n"
  );
}

main();
