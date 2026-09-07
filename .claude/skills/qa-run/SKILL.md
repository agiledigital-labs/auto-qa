---
name: qa-run
description: Fetch a Jira ticket's QA statement, lint it, execute it via Playwright MCP against a deployed environment, and produce a Jira-paste-ready results summary.
arguments: [ticket_key]
argument-hint: "[TICKET-KEY]"
disable-model-invocation: true
---

Run the full QA workflow for Jira ticket **$ticket_key**. Follow these steps in order, in this session (do not fork or delegate the whole skill to a subagent — steps 2, 3, and 5 need to ask the user questions directly).

## 1. Fetch the ticket

Run:
```
node scripts/jira-fetch.mjs $ticket_key
```
via Bash. If it exits non-zero, its stderr message explains why (bad credentials, ticket not found, or no QA statement could be found on the ticket at all). Report that message to the user directly and **stop** — there's nothing to lint or execute yet. Common fixes to suggest: create `.env` from `.env.example` and fill in `JIRA_EMAIL`/`JIRA_API_TOKEN`, set the real `domain` in `config/jira.config.json`, or add a `projects.<KEY>` entry there for this ticket's project.

If it succeeds, it prints a JSON object: `{ key, projectKey, summary, description, qaStatement }`.

Create the run directory now: `runs/<key>-<timestamp>/` where `<timestamp>` is the current time as `YYYY-MM-DDTHH-MM-SS` (colons replaced with dashes so it's filesystem-safe). Write the fetched JSON to `<run-dir>/ticket.json`. Also create `<run-dir>/screenshots/`.

## 2. Choose optional extras

Use `AskUserQuestion` (`multiSelect: true`) to ask which optional extras this run should include, beyond the standard lint + execute + summarize flow:
- **Generate a Playwright regression script** — also produce a reusable, git-trackable `@playwright/test` script (`tests/regression/<key>.spec.ts`) covering the automated steps of this run, for re-running as a regression check in the future. Adds some time; review the emitted script before trusting it.
- **Additional exploratory testing** — after the QA statement's own steps, have the executor spend some bounded extra effort probing related edge cases the QA statement doesn't explicitly cover (boundary input, error states, adjacent UI). Adds some time; findings are reported separately from the formal QA steps.
- **Accessibility/UX testing** — after the QA statement's own steps, have the executor spend some bounded extra effort checking the pages/flows it just touched for accessibility and UX issues (missing labels/alt text, heading structure, keyboard/focus handling, unclear error messaging, obvious UX friction). Heuristic, not a full audit — adds some time; findings are reported separately from the formal QA steps.

Any combination, or none, may be selected — none is the normal/default case and it's fine if the user picks nothing. Remember the selections; you'll use them in step 6.

## 3. Load or create the project's shared QA context

Check whether `context/<projectKey>.md` exists.

- **If it exists**, read it — this is the shared context you'll pass to both subagents.
- **If it doesn't exist**, this is the first `qa-run` for this Jira project. Use `AskUserQuestion` to ask for the essentials before proceeding:
  - Where is the app deployed for QA (staging URL, or however environments are identified for this project)?
  - What login/credentials should QA use, and where is the actual secret value stored (tell the user to add it to `.env` as e.g. `<PROJECTKEY>_STAGING_QA_PASSWORD` — never ask them to paste the secret itself into chat)?
  - Any test data or fixtures that generally need to exist before QA statements in this project can be run (optional — skip if not applicable)?

  Create `context/<projectKey>.md` from this template, filled in with the answers:
  ```markdown
  # QA Context — <PROJECT_KEY>

  ## Environments
  - <answer>

  ## Test Data
  - <answer, or "None noted yet.">

  ## Known Gotchas
  - None noted yet.

  ## Context Log
  - <today's date>: initial context created (from <ticket key> run)
  ```
  This file is meant to be git-tracked and shared with the team — mention that to the user once created, and remind them that any secret values referenced by name here (e.g. env var names) must be added to `.env` locally by each person running this tool, since `.env` itself isn't shared.

Also check whether `context/<projectKey>.app-notes.md` exists. This is a separate, auto-maintained knowledge base of *how to drive this app's UI* via Playwright MCP — navigation paths, form quirks, reliable selectors — built up by `qa-executor` itself across runs, not by asking you anything. Don't create it and don't ask the user about it if it's missing; an absent file just means `qa-executor` is starting from scratch and will create it after this run. Just note its path either way — you'll hand it to `qa-executor` in step 6 alongside the resolved QA context. It's a plain, secret-free file (UI facts only), so unlike the QA context it never needs to go through `resolve-context.mjs` — pass its path straight through.

## 4. Run QA Lint

Spawn the `qa-linter` subagent (Agent tool, `subagent_type: "qa-linter"`). In its prompt, give it: the ticket's `description`, the `qaStatement`, the full contents of `context/<projectKey>.md`, and the exact target path `<run-dir>/lint.json` to write its findings to.

Once it finishes, read `<run-dir>/lint.json`.

## 5. Resolve blocking issues, if any

If `lint.json` has any finding with `severity: "blocking"`:

- For findings with `category: "missing-context"`: use `AskUserQuestion` to ask the user each finding's `suggestedQuestion` (batch them into one call if there are multiple). Once answered, **append** the new information to `context/<projectKey>.md` — add it under the relevant section (`Environments`, `Test Data`, or `Known Gotchas`) and add a dated entry under `Context Log` noting it was resolved from this ticket's run. Then re-spawn `qa-linter` (step 4) with the updated context so it can confirm the finding is resolved. Repeat until no missing-context blocking findings remain.
- For findings with `category: "clarity"` or `"scope-mismatch"` (the QA statement itself is the problem): present these findings to the user plainly, and ask them (a plain question, or `AskUserQuestion` with two options) whether to:
  - **Stop** — the ticket's QA statement should be fixed in Jira first, or
  - **Proceed anyway** — the user supplies a one-off clarification inline (e.g. "treat step 3 as meaning X") that you'll pass to `qa-executor` as extra context for *this run only*. Do not write this to `context/<projectKey>.md` — it's ticket-specific, not project-wide.

  If the user chooses to stop, write what you have so far (report the lint findings to the user) and end here — do not run `render-summary.mjs` on an incomplete run.

- For findings with `category: "external-access"` (a step requires visiting or authenticating to something outside the deployed app under test — e.g. a Confluence page): this is a scope decision, not a data gap, so there's no `suggestedQuestion` to relay. Present the finding to the user and use `AskUserQuestion` to ask how to handle *that specific step*:
  - **Confirm it manually now (recommended)** — ask the user directly, in a plain follow-up question, for the outcome of that step (pass/fail, and any notes) as if they'd just checked it themselves.
  - **Skip this step for this run** — it won't be attempted at all.
  - **Let the automated session access it anyway** — only if the user is confident automated access to that specific resource is actually fine (e.g. it turns out to be a low-sensitivity internal page and they're OK with it being visited unattended).

  For the first two choices, record a **pre-resolved step** and set it aside for step 6 — it will *not* be given to `qa-executor` and will not be attempted by automation:
  - Manual confirmation → `{ stepText, status: "pass" | "fail" (per the user's answer), severity (only if "fail"), notes: "Manually verified by user, not automated: <their answer>" }`
  - Skip → `{ stepText, status: "not-run", notes: "Skipped — external resource, not attempted by automated execution (user's choice)." }`

  For the third choice, record nothing — leave that step in the QA statement as normal so `qa-executor` attempts it in step 6.

  This decision is ticket-specific, not project-wide — don't write it to `context/<projectKey>.md`, unless the user explicitly says access to that resource should be trusted for future runs too, in which case add a note under `Known Gotchas` so a future lint pass on this project won't re-flag it. `external-access` findings don't need a re-lint pass once you've recorded how each one will be handled (unlike `missing-context`) — treat it as resolved immediately.

Once there are no unresolved `blocking` findings (either none existed, or they were resolved above), continue. Keep whatever list of pre-resolved steps you built up in this section — you'll need it in step 6.

## 6. Execute the QA statement

First, resolve the shared context's env var references into real values, server-side — the executor must never see raw `.env` contents or env var names it has to resolve itself, and those values must never pass through this session's own output either. Run:
```
node scripts/resolve-context.mjs <projectKey> <run-dir>/context.resolved.md
```
via Bash. If it exits non-zero, its stderr names the missing env var(s) — report that to the user (tell them which var(s) to add to `.env`) and **stop**, same as a step 1 failure. Its stdout only ever lists variable *names* it resolved, never values — do not attempt to read `.env` yourself or otherwise print/relay secret values into this conversation.

Split the QA statement into an ordered list of discrete steps if it isn't already itemized, preserving any inline markdown links verbatim as you do (a step that references an external page, mockup, or ticket must keep that URL intact rather than being paraphrased). Remove from this list any step you recorded as a **pre-resolved step** in step 5 (matched by its original text) — those are not to be attempted by automation.

- If steps remain after removing the pre-resolved ones, spawn the `qa-executor` subagent (Agent tool, `subagent_type: "qa-executor"`). In its prompt, give it: the remaining steps (as an ordered list), the path `<run-dir>/context.resolved.md` (tell it to `Read` this itself — do not paste its contents into the prompt), the path `context/<projectKey>.app-notes.md` from step 3 (tell it to `Read` this itself if it exists, and that it's responsible for creating/updating it at the end of its run), any inline clarification gathered in step 5, and the run directory path `<run-dir>` (it writes `<run-dir>/execution.json` and screenshots under `<run-dir>/screenshots/`).

  If **regression script generation** was selected in step 2: also give it the output path `tests/regression/<key>.spec.ts` (create the `tests/regression/` directory first if it doesn't exist — this directory is git-tracked, unlike `runs/`) and the path `context/<projectKey>.md` (the *unresolved* one, for env var names — tell it to `Read` this itself), and tell it to follow its "Emit a regression script" instructions.

  If **exploratory testing** was selected in step 2: tell it to also follow its "Exploratory testing" instructions after finishing the QA statement's steps.

  If **accessibility/UX testing** was selected in step 2: tell it to also follow its "Accessibility/UX testing" instructions after finishing the QA statement's steps.

  Don't be concerned if `qa-executor` reports that something in `context/<projectKey>.app-notes.md` didn't match reality (a selector, a flow, a navigation path) — that file is a best-effort, self-revising knowledge base, not a source of truth, and `qa-executor` is expected to adapt and correct it rather than treat the mismatch as a QA statement failure.

  Once it finishes, if you have any pre-resolved steps from step 5, read `<run-dir>/execution.json`, splice the pre-resolved step entries back in at their original positions in the QA statement's order, and rewrite the file so `execution.json` reflects every step of the original QA statement, not just the automated ones. Leave `explorationFindings`/`accessibilityFindings`/`regressionScriptPath`, if present, untouched.

- If every step was pre-resolved (no steps remain to hand to `qa-executor`), don't spawn it at all — write `<run-dir>/execution.json` yourself directly, containing just the pre-resolved step entries in their original order. (All three optional extras require automated execution to have actually happened, so if you skipped spawning `qa-executor` entirely, none of them apply to this run regardless of what was selected in step 2 — mention that to the user in step 8.)

## 7. Render the summary

Run:
```
node scripts/render-summary.mjs <run-dir>
```
via Bash. This reads `ticket.json`, `lint.json`, and `execution.json` from the run directory and writes `<run-dir>/summary.md`.

## 8. Report to the user

Print the full contents of `<run-dir>/summary.md` to the user (it's Markdown, formatted to paste directly into a Jira comment), and tell them the file path so they can find the screenshots alongside it. If a regression script was generated, point out its path (`tests/regression/<key>.spec.ts`) and mention it's git-trackable and worth a quick review before committing or relying on it — unlike everything else this tool writes, it isn't excluded by `.gitignore`. Do not post anything to Jira automatically — this tool is local-output-only by design.
