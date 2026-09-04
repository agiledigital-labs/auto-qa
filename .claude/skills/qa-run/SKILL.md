---
name: qa-run
description: Fetch a Jira ticket's QA statement, lint it, execute it via Playwright MCP against a deployed environment, and produce a Jira-paste-ready results summary.
arguments: [ticket_key]
argument-hint: [TICKET-KEY]
disable-model-invocation: true
---

Run the full QA workflow for Jira ticket **$ticket_key**. Follow these steps in order, in this session (do not fork or delegate the whole skill to a subagent — steps 2 and 4 need to ask the user questions directly).

## 1. Fetch the ticket

Run:
```
node scripts/jira-fetch.mjs $ticket_key
```
via Bash. If it exits non-zero, its stderr message explains why (bad credentials, ticket not found, or no QA statement could be found on the ticket at all). Report that message to the user directly and **stop** — there's nothing to lint or execute yet. Common fixes to suggest: create `.env` from `.env.example` and fill in `JIRA_EMAIL`/`JIRA_API_TOKEN`, set the real `domain` in `config/jira.config.json`, or add a `projects.<KEY>` entry there for this ticket's project.

If it succeeds, it prints a JSON object: `{ key, projectKey, summary, description, qaStatement }`.

Create the run directory now: `runs/<key>-<timestamp>/` where `<timestamp>` is the current time as `YYYY-MM-DDTHH-MM-SS` (colons replaced with dashes so it's filesystem-safe). Write the fetched JSON to `<run-dir>/ticket.json`. Also create `<run-dir>/screenshots/`.

## 2. Load or create the project's shared QA context

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

## 3. Run QA Lint

Spawn the `qa-linter` subagent (Agent tool, `subagent_type: "qa-linter"`). In its prompt, give it: the ticket's `description`, the `qaStatement`, the full contents of `context/<projectKey>.md`, and the exact target path `<run-dir>/lint.json` to write its findings to.

Once it finishes, read `<run-dir>/lint.json`.

## 4. Resolve blocking issues, if any

If `lint.json` has any finding with `severity: "blocking"`:

- For findings with `category: "missing-context"`: use `AskUserQuestion` to ask the user each finding's `suggestedQuestion` (batch them into one call if there are multiple). Once answered, **append** the new information to `context/<projectKey>.md` — add it under the relevant section (`Environments`, `Test Data`, or `Known Gotchas`) and add a dated entry under `Context Log` noting it was resolved from this ticket's run. Then re-spawn `qa-linter` (step 3) with the updated context so it can confirm the finding is resolved. Repeat until no missing-context blocking findings remain.
- For findings with `category: "clarity"` or `"scope-mismatch"` (the QA statement itself is the problem): present these findings to the user plainly, and ask them (a plain question, or `AskUserQuestion` with two options) whether to:
  - **Stop** — the ticket's QA statement should be fixed in Jira first, or
  - **Proceed anyway** — the user supplies a one-off clarification inline (e.g. "treat step 3 as meaning X") that you'll pass to `qa-executor` as extra context for *this run only*. Do not write this to `context/<projectKey>.md` — it's ticket-specific, not project-wide.

  If the user chooses to stop, write what you have so far (report the lint findings to the user) and end here — do not run `render-summary.mjs` on an incomplete run.

Once there are no unresolved `blocking` findings (either none existed, or they were resolved above), continue.

## 5. Execute the QA statement

Spawn the `qa-executor` subagent (Agent tool, `subagent_type: "qa-executor"`). In its prompt, give it: the QA statement (as an ordered list — split it into discrete steps if it isn't already itemized), the full contents of `context/<projectKey>.md`, any inline clarification gathered in step 4, and the run directory path `<run-dir>` (it writes `<run-dir>/execution.json` and screenshots under `<run-dir>/screenshots/`).

## 6. Render the summary

Run:
```
node scripts/render-summary.mjs <run-dir>
```
via Bash. This reads `ticket.json`, `lint.json`, and `execution.json` from the run directory and writes `<run-dir>/summary.md`.

## 7. Report to the user

Print the full contents of `<run-dir>/summary.md` to the user (it's Markdown, formatted to paste directly into a Jira comment), and tell them the file path so they can find the screenshots alongside it. Do not post anything to Jira automatically — this tool is local-output-only by design.
