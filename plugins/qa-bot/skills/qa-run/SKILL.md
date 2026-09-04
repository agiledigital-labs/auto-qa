---
name: qa-run
description: Fetch a ticket's QA statement (from Jira via an Atlassian MCP connection, or pasted manually from any issue tracker), lint it, execute it against a deployed system (browser UI via Playwright MCP, HTTP APIs via curl) and produce a paste-ready results summary.
argument-hint: "[TICKET-KEY] [--non-interactive] [--project KEY] [--ticket-file PATH] [--run-dir PATH] [--extras regression,exploratory,accessibility] [--retest [PATH]] [--post-comment]"
disable-model-invocation: true
---

Run the full QA workflow. Arguments: `$ARGUMENTS`. Follow these steps in order, in this session (do not fork or delegate the whole skill to a subagent - several steps need to ask the user questions directly).

The arguments are a ticket key plus optional flags, described in `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/run-options.md` - read it before step 1. With `--non-interactive`, every **Non-interactive** rule below applies, and "stop" means stop as that file describes.

All paths below (`runs/`, `context/`, `tests/regression/`, `.env`) are relative to the current project root, not to this plugin.

**Secrets rule for the whole run:** never `Read`, `cat`, or otherwise print `.env` or any secret value into this conversation, and never pass one to a subagent. Secrets are referenced only by env var *name*. The Playwright MCP server loads `.env` itself (`--secrets`), and `qa-executor`'s `curl` requests load it into a subshell (or, non-interactively, have `curl` read the environment), so values are substituted without ever appearing in a prompt or tool call.

## 0. Re-test or fresh run

A **re-test** re-runs a ticket after the developer has addressed issues from an earlier run, possibly with an amended QA statement. It is a complete run of the current QA statement - every step, from scratch - compared afterwards with the previous run so the summary shows what was fixed, what still fails and what regressed.

Find previous runs of this ticket, taking `<key>` from the arguments (if it's missing, ask for it as intake step 1 describes): `grep -lE '"key": *"<key>"' runs/*/ticket.json`, keeping only directories that also hold an `execution.json`. Take the previous run's outcome from its `result.json`, or else from the `## Decision:` line of its `summary.md`.

- `--retest <path>`: re-test against that run directory. Stop if it holds no `execution.json` or its `ticket.json` is for another key.
- `--retest` without a path: re-test against the most recently modified matching directory (`ls -td` on them). Stop if there is none.
- No `--retest`, interactive: if previous runs for the same key exist, use `AskUserQuestion` to ask whether this is a **re-test** of the most recent one (name its directory and outcome) or a **fresh run**. Otherwise it's a fresh run.
- No `--retest`, **non-interactive:** a fresh run.

Remember the previous run directory as `<previous-run-dir>`, if any - later steps use it.

## 1–3. Set up the run, load the project's QA context, fetch the ticket

Read `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/ticket-intake.md` and follow its steps 1–3, taking the ticket key and flags from the arguments above. Later steps refer back to them by number; `<run-dir>` is the run directory created in step 1. Then create `screenshots/` and `responses/` inside `<run-dir>`.

Also check whether `context/<projectKey>.app-notes.md` exists. This is a separate, auto-maintained knowledge base of *how to drive this system* - UI navigation paths, form quirks, reliable selectors, API auth flows and conventions - built up by `qa-executor` itself across runs, not by asking you anything. Don't create it and don't ask the user about it if it's missing; an absent file just means `qa-executor` is starting from scratch and will create it after this run. Just note its path - you'll hand it to `qa-executor` in step 7. It holds facts about the system only, no secrets.

## 4. Classify the QA statement and choose optional extras

Read the QA statement and decide which **surfaces** it exercises: **browser UI** (pages, forms, what a user sees), **HTTP API** (requests, endpoints, status codes, payloads), or both. If it's genuinely unclear, ask the user (**non-interactive:** treat it as both). You'll use this to check prerequisites and brief the executor in step 7.

Then, unless `--extras` was given, use `AskUserQuestion` (`multiSelect: true`) to ask which optional extras this run should include, beyond the standard lint + execute + summarise flow:
- **Generate a regression script** - also produce a reusable, git-trackable script covering the automated steps of this run, for re-running as a regression check in the future: a `@playwright/test` spec (`tests/regression/<run-slug>.spec.ts`) if the statement involves browser UI, otherwise a dependency-free Node `node:test` script (`tests/regression/<run-slug>.test.mjs`). Name the format that applies when offering it. Adds some time; review the emitted script before trusting it.
- **Additional exploratory testing** - after the QA statement's own steps, have the executor spend some bounded extra effort probing related edge cases the QA statement doesn't explicitly cover (boundary input, error states, adjacent UI; for APIs, missing/invalid auth and malformed requests). Adds some time; findings are reported separately from the formal QA steps.
- **Accessibility/UX testing** - *offer this only if the statement involves browser UI.* After the QA statement's own steps, have the executor spend some bounded extra effort checking the pages/flows it just touched for accessibility and UX issues (missing labels/alt text, heading structure, keyboard/focus handling, unclear error messaging, obvious UX friction). Heuristic, not a full audit - adds some time; findings are reported separately from the formal QA steps.
- **None** - do not include any optional extras beyond the standard flow.

Any combination, or none, may be selected - none is the normal/default case and it's fine if the user picks nothing. `--extras` names them as `regression`, `exploratory` and `accessibility`; ignore `accessibility` if the statement has no browser UI, and mention that in step 9. **Non-interactive:** without `--extras`, select none. Remember the selections; you'll use them in step 7.

## 5. Run QA Lint

Spawn the `qa-linter` subagent (Agent tool, `subagent_type: "qa-bot:qa-linter"`). In its prompt, give it: the ticket's `description` (or the words "Not provided" if it's empty), the `qaStatement`, the full contents of `context/<projectKey>.md`, and the exact target path `<run-dir>/lint.json` to write its findings to.

Once it finishes, read `<run-dir>/lint.json`.

## 6. Resolve blocking issues, if any

If `lint.json` has any finding with `severity: "blocking"`:

- For findings with `category: "missing-context"`: use `AskUserQuestion` to ask the user each finding's `suggestedQuestion` (batch them into one call if there are multiple). Once answered, sort each answer - or each part of one - by the context conventions in step 2. Add project-level facts to `context/<projectKey>.md`, summarised at a high level under the relevant section (`Environments`, `Test Data`, or `Known Gotchas`), with a dated `Context Log` entry noting they came from this ticket's run. Keep ticket-specific details as **run context**, used for this run only and not persisted; when unsure which an answer is, keep it as run context. Then re-spawn `qa-linter` (step 5) with the updated context plus the run context, so it can confirm the finding is resolved. Repeat until no missing-context blocking findings remain. **Non-interactive:** stop, with every such finding's `suggestedQuestion` in the message.
- For findings with `category: "clarity"` or `"scope-mismatch"` (the QA statement itself is the problem): present these findings to the user plainly, and ask them (a plain question, or `AskUserQuestion` with two options) whether to:
  - **Stop** - the ticket's QA statement should be fixed in the issue tracker first, or
  - **Proceed anyway** - the user supplies a one-off clarification inline (e.g. "treat step 3 as meaning X") that you'll pass to `qa-executor` as extra context for *this run only*. Do not write this to `context/<projectKey>.md` - it's ticket-specific, not project-wide.

  If the user chooses to stop, report the lint findings to the user and stop - do not write a summary for an incomplete run. **Non-interactive:** stop, with these findings' summaries in the message.

- For findings with `category: "external-access"` (a step requires visiting, calling or authenticating to something outside the system under test - e.g. a Confluence page or a third-party API): this is a scope decision, not a data gap, so there's no `suggestedQuestion` to relay. Present the finding to the user and use `AskUserQuestion` to ask how to handle *that specific step*:
  - **Confirm it manually now (recommended)** - ask the user directly, in a plain follow-up question, for the outcome of that step (pass/fail, and any notes) as if they'd just checked it themselves.
  - **Skip this step for this run** - it won't be attempted at all.
  - **Let the automated session access it anyway** - only if the user is confident automated access to that specific resource is actually fine (e.g. it turns out to be a low-sensitivity internal page and they're OK with it being visited unattended).

  For the first two choices, record a **pre-resolved step** and set it aside for step 7 - it will *not* be given to `qa-executor` and will not be attempted by automation:
  - Manual confirmation → `{ stepText, status: "pass" | "fail" (per the user's answer), severity (only if "fail"), notes: "Manually verified by user, not automated: <their answer>" }`
  - Skip → `{ stepText, status: "not-run", notes: "Skipped - external resource, not attempted by automated execution (user's choice)." }`

  For the third choice, record nothing - leave that step in the QA statement as normal so `qa-executor` attempts it in step 7.

  This decision is ticket-specific, not project-wide - don't write it to `context/<projectKey>.md`, unless the user explicitly says access to that resource should be trusted for future runs too, in which case add a note under `Known Gotchas` so a future lint pass on this project won't re-flag it. `external-access` findings don't need a re-lint pass once you've recorded how each one will be handled (unlike `missing-context`) - treat it as resolved immediately.

  **Non-interactive:** skip every such step - record it as a pre-resolved step `{ stepText, status: "not-run", notes: "Skipped - external resource, not attempted in non-interactive mode." }`.

Once there are no unresolved `blocking` findings (either none existed, or they were resolved above), continue. Keep whatever list of pre-resolved steps you built up in this section - you'll need it in step 7.

## 7. Execute the QA statement

First, check the prerequisites for the surfaces from step 4, without exposing any secret value. If any check fails, tell the user what to fix and stop.

- **`.env` exists** in the project root (`test -f .env`). Both surfaces load secrets from it, and the Playwright MCP server won't start without it. It may be empty if no secrets are referenced.
- **Every referenced secret is set.** Collect every backtick-quoted `SCREAMING_SNAKE_CASE` token in `context/<projectKey>.md` and, for each, run this via Bash with the name written out literally in all three places (no loops or shell variables, so a permission allowlist can match it):
  ```
  grep -qE '^[[:space:]]*(export[[:space:]]+)?NAME_ONE[[:space:]]*=[[:space:]]*[^[:space:]#]' .env && echo 'NAME_ONE: set' || echo 'NAME_ONE: missing'
  ```
  This prints names only. For any `missing`, tell the user which var(s) to add to `.env`, and that the Playwright MCP server reads `.env` only at startup, so it needs reconnecting via `/mcp` afterwards. Skip this check if there are no tokens.
- **Browser UI:** the Playwright MCP tools are available (e.g. `mcp__plugin_qa-bot_playwright__browser_navigate` - use `ToolSearch` if deferred). If they aren't, the usual cause is that `.env` was missing when the session started; tell the user to reconnect the server via `/mcp` (or restart the session).
- **HTTP API:** `curl` is installed (`command -v curl`). Remind the user once that `.env` is also loaded by the shell for API requests, so any value containing spaces, `$` or quotes must be single-quoted there. **Non-interactive:** instead check that `curl --version` reports 8.3 or later (needed to read secrets from the environment).

On a re-test, hand over the complete current QA statement, just as for a fresh run: every step is executed again, including those that passed before, and no earlier result or evidence is carried over. Don't tell `qa-executor` about the previous run or which steps failed in it, so it can't narrow its attention to them.

Split the QA statement into an ordered list of discrete steps if it isn't already itemised, preserving any inline markdown links verbatim as you do (a step that references an external page, mockup, or ticket must keep that URL intact rather than being paraphrased). Remove from this list any step you recorded as a **pre-resolved step** in step 6 (matched by its original text) - those are not to be attempted by automation.

- If steps remain after removing the pre-resolved ones, spawn the `qa-executor` subagent (Agent tool, `subagent_type: "qa-bot:qa-executor"`). In its prompt, give it: the remaining steps (as an ordered list), the ticket key and summary, the surfaces from step 4, the path `context/<projectKey>.md` (tell it to `Read` this itself - do not paste its contents into the prompt), the path `context/<projectKey>.app-notes.md` from step 2 (tell it to `Read` this itself if it exists, and that it's responsible for creating/updating it at the end of its run), any inline clarification and run context gathered in step 6, whether the run is non-interactive (it then reads API secrets from the environment), and the run directory path `<run-dir>` (it writes `<run-dir>/execution.json`, screenshots under `<run-dir>/screenshots/` and API responses under `<run-dir>/responses/`).

  If **regression script generation** was selected in step 4: also give it the output path - `tests/regression/<run-slug>.spec.ts` if the surfaces from step 4 include browser UI, otherwise `tests/regression/<run-slug>.test.mjs` (create the `tests/regression/` directory first if it doesn't exist - this directory is git-tracked, unlike `runs/`), and tell it to follow its "Emit a regression script" instructions.

  If **exploratory testing** was selected in step 4: tell it to also follow its "Exploratory testing" instructions after finishing the QA statement's steps.

  If **accessibility/UX testing** was selected in step 4: tell it to also follow its "Accessibility/UX testing" instructions after finishing the QA statement's steps.

  Don't be concerned if `qa-executor` reports that something in `context/<projectKey>.app-notes.md` didn't match reality (a selector, a flow, an endpoint) - that file is a best-effort, self-revising knowledge base, not a source of truth, and `qa-executor` is expected to adapt and correct it rather than treat the mismatch as a QA statement failure.

  Once it finishes, if you have any pre-resolved steps from step 6, read `<run-dir>/execution.json`, splice the pre-resolved step entries back in at their original positions in the QA statement's order, and rewrite the file so `execution.json` reflects every step of the original QA statement, not just the automated ones. Leave `explorationFindings`/`accessibilityFindings`/`regressionScriptPath`, if present, untouched.

- If every step was pre-resolved (no steps remain to hand to `qa-executor`), don't spawn it at all - write `<run-dir>/execution.json` yourself directly, containing just the pre-resolved step entries in their original order. (All three optional extras require automated execution to have actually happened, so if you skipped spawning `qa-executor` entirely, none of them apply to this run regardless of what was selected in step 4 - mention that to the user in step 9.)

### Compare with the previous run (re-test only)

Read `<previous-run-dir>/execution.json` and match each entry of the new `steps` to a previous step: the same step if the text is identical or a light rewording of the same check, otherwise none (a new or materially amended step). Write `<run-dir>/retest.json`:

```json
{
  "previousRunDir": "runs/PROJ-123-2026-11-06T12-29-53",
  "previousOutcome": "accept-with-follow-ups",
  "steps": [
    { "stepText": "Verify that userId is a UUID", "previousStatus": "fail", "status": "pass" },
    { "stepText": "Verify that the response is paginated", "previousStatus": null, "status": "pass" }
  ],
  "removedSteps": ["Previous step text with no counterpart in the current statement"]
}
```

`steps` has one entry per new `steps` entry, in order, with `stepText` and `status` copied from it; `previousStatus` is the matched previous step's status, or `null` if none matched. `removedSteps` lists previous steps nothing matched. Compare `steps` only - exploratory and accessibility findings aren't compared.

## 8. Render the summary

Read `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/summary-template.md` and follow it exactly to build `<run-dir>/summary.md` from `ticket.json`, `lint.json`, `execution.json` and, on a re-test, `retest.json` in the run directory.

## 9. Report to the user

Print the full contents of `<run-dir>/summary.md` to the user (it's Markdown, formatted to paste into a ticket comment), and tell them the file path so they can find the screenshots and saved responses alongside it. Saved responses may contain tokens or personal data returned by the API - they stay local under `runs/`; mention that if any were saved. If a regression script was generated, point out its path, mention it's git-trackable and worth a quick review before committing or relying on it, and how to run it: a `.spec.ts` needs `@playwright/test` installed in the project (`npx playwright test <path>`); a `.test.mjs` needs only Node ≥ 20.12 (`node --test <path>`).

If step 6 gathered any answers, say which were saved to `context/<projectKey>.md` and which were used for this run only, so the user can correct the split.

Then offer to post `summary.md` to the ticket, or post it, following "Posting the result to Jira" in `run-options.md`. Post nothing else to the issue tracker.

On a re-test, if `<previous-run-dir>` produced a regression script and this run didn't regenerate it, mention that the script may no longer match an amended QA statement.

Finally, write `<run-dir>/result.json` with `status: "completed"`, the decision as `outcome`, `<previous-run-dir>` (or `null`) as `retestOf`, and `commentId`, as `run-options.md` describes.
