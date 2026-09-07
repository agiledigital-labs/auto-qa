#!/usr/bin/env node
// Renders a Jira-paste-ready Markdown summary from a run directory.
//
// Usage: node scripts/render-summary.mjs runs/PROJ-123-2026-09-04T12-00-00
//
// Reads from the run directory:
//   ticket.json     { key, qaStatement, ... }        (required)
//   lint.json       { findings: [...] }               (optional, treated as no findings if absent)
//   execution.json  { steps: [...], explorationFindings: [...], accessibilityFindings: [...],
//                      regressionScriptPath }
//                                                      (optional, treated as not-yet-run if absent;
//                                                       explorationFindings/accessibilityFindings/
//                                                       regressionScriptPath are themselves optional
//                                                       extras within execution.json)
// Writes: <run-dir>/summary.md

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const SEVERITY_EMOJI = { blocking: "🔴", major: "🟠", minor: "🟡" };

function readJsonIfExists(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function renderLintSection(findings) {
  if (!findings.length) return "";
  const order = { blocking: 0, major: 1, minor: 2 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  const lines = sorted.map((f) => {
    const emoji = SEVERITY_EMOJI[f.severity] ?? "⚪";
    const fix = f.suggestedFix ? ` — _suggested fix: ${f.suggestedFix}_` : "";
    return `- ${emoji} *(${f.severity}, ${f.category})* ${f.summary}${fix}`;
  });
  return `## QA Statement / Ticket Review\n${lines.join("\n")}\n\n`;
}

function stepEmoji(step) {
  if (step.status === "pass") return "✅";
  if (step.status === "not-run") return "⏭️";
  // status === "fail"
  return step.severity === "minor" ? "⚠️" : "❌";
}

function renderStepsSection(steps, runDirName, heading, emptyText) {
  if (!steps.length) {
    return emptyText ? `## ${heading}\n${emptyText}\n\n` : "";
  }
  const lines = steps.map((s) => {
    const emoji = stepEmoji(s);
    let line = `- ${emoji} ${s.stepText}`;
    if (s.status === "fail") {
      line += ` — **${s.severity}**: ${s.notes ?? "failed"}`;
      if (s.screenshotPath) {
        line += ` ([screenshot](${path.relative(runDirName, s.screenshotPath) || s.screenshotPath}))`;
      }
    } else if (s.status === "not-run") {
      line += ` — not run: ${s.notes ?? "blocked by an earlier failure"}`;
    } else if (s.notes) {
      line += ` — ${s.notes}`;
    }
    return line;
  });
  return `## ${heading}\n${lines.join("\n")}\n\n`;
}

function decide(findings, steps) {
  const hasBlockingLint = findings.some((f) => f.severity === "blocking");
  const hasBlockingExec = steps.some((s) => s.status === "fail" && s.severity === "blocking");
  if (hasBlockingLint || hasBlockingExec) {
    return { emoji: "❌", label: "Reject" };
  }
  const hasNonBlockingIssue =
    findings.some((f) => f.severity === "major" || f.severity === "minor") ||
    steps.some((s) => s.status === "fail");
  if (hasNonBlockingIssue) {
    return { emoji: "✅", label: "Accept with follow-ups" };
  }
  return { emoji: "✅", label: "Accept" };
}

function renderFollowUps(findings, steps) {
  const followUps = [
    ...findings.filter((f) => f.severity !== "blocking").map((f) => f.summary),
    ...steps.filter((s) => s.status === "fail" && s.severity !== "blocking").map((s) => `${s.stepText}: ${s.notes ?? ""}`.trim()),
  ];
  if (!followUps.length) return "";
  return `### Suggested follow-ups (non-blocking)\n${followUps.map((f) => `- ${f}`).join("\n")}\n`;
}

function renderRegressionScriptNote(scriptPath, runDir) {
  if (!scriptPath) return "";
  const rel = path.relative(runDir, scriptPath) || scriptPath;
  return `## Regression Test\nA reusable Playwright regression script was generated: [\`${rel}\`](${rel}). Run it later with \`npx playwright test ${rel}\`.\n\n`;
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error("render-summary: usage: node scripts/render-summary.mjs <run-dir>");
    process.exit(1);
  }

  const ticketPath = path.join(runDir, "ticket.json");
  if (!existsSync(ticketPath)) {
    console.error(`render-summary: missing ${ticketPath}`);
    process.exit(1);
  }
  const ticket = JSON.parse(readFileSync(ticketPath, "utf8"));
  const lint = readJsonIfExists(path.join(runDir, "lint.json"), { findings: [] });
  const execution = readJsonIfExists(path.join(runDir, "execution.json"), { steps: [] });

  const findings = lint.findings ?? [];
  const steps = execution.steps ?? [];
  const explorationFindings = execution.explorationFindings ?? [];
  const accessibilityFindings = execution.accessibilityFindings ?? [];
  const allSteps = [...steps, ...explorationFindings, ...accessibilityFindings];
  const decision = decide(findings, allSteps);

  const parts = [
    `# QA Results — ${ticket.key}`,
    "",
    renderLintSection(findings),
    renderStepsSection(steps, runDir, "QA Steps", "_Execution was not run for this ticket._"),
    renderStepsSection(explorationFindings, runDir, "Exploratory Testing", ""),
    renderStepsSection(accessibilityFindings, runDir, "Accessibility/UX Testing", ""),
    renderRegressionScriptNote(execution.regressionScriptPath, runDir),
    `## Decision: ${decision.emoji} ${decision.label}`,
    "",
    renderFollowUps(findings, allSteps),
  ];

  const summary = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  const outPath = path.join(runDir, "summary.md");
  writeFileSync(outPath, summary, "utf8");
  console.log(`render-summary: wrote ${outPath}`);
}

main();
