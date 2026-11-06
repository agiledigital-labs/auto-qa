---
name: qa-lint
description: Fetch a ticket's QA statement (from Jira via an Atlassian MCP connection, or pasted manually from any issue tracker), lint it for clarity, scope, missing context and external access, and check the ticket's hygiene (QA-ready status, open sub-tasks and blockers), without executing anything. Produces a paste-ready lint report.
argument-hint: "[TICKET-KEY] [--non-interactive] [--project KEY] [--ticket-file PATH] [--run-dir PATH] [--post-comment]"
disable-model-invocation: true
---

Lint a ticket's QA statement without executing it. Arguments: `$ARGUMENTS`. Follow these steps in order, in this session (do not fork or delegate the whole skill to a subagent - the intake steps may need to ask the user questions directly).

The arguments are a ticket key plus optional flags, described in `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/run-options.md` - read it before step 1. `--extras` doesn't apply to this skill. With `--non-interactive`, that file's non-interactive rules apply.

All paths below (`runs/`, `context/`, `.env`) are relative to the current project root, not to this plugin.

**Secrets rule:** never `Read`, `cat`, or otherwise print `.env` or any secret value into this conversation, and never pass one to a subagent. Secrets are referenced only by env var *name*.

## 1–3. Set up the run, load the project's QA context, fetch the ticket

Read `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/ticket-intake.md` and follow its steps 1–3, taking the ticket key and flags from the arguments above. `<run-dir>` is the run directory created in step 1.

## 4. Run QA Lint

Spawn the `qa-linter` subagent (Agent tool, `subagent_type: "qa-bot:qa-linter"`). In its prompt, give it: the ticket's `description` (or the words "Not provided" if it's empty), the `qaStatement`, the full contents of `context/<projectKey>.md`, and the exact target path `<run-dir>/lint.json` to write its findings to.

Once it finishes, read `<run-dir>/lint.json`.

## 5. Check ticket hygiene

Read `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/ticket-hygiene.md` and follow it to write `<run-dir>/hygiene.json`.

## 6. Render the lint report

Build `<run-dir>/lint.md` from `ticket.json`, `lint.json` and, if it exists, `hygiene.json`. Copy `summary`, `suggestedFix` and `suggestedQuestion` text verbatim; do not reword, merge or editorialise.

```markdown
# QA Lint - <ticket.key>

_QA statement supplied manually, not fetched from the issue tracker, so ticket hygiene was not checked._   ← only if ticket.source is "manual"

## QA Statement Review
- <lint line>                                                      ← one per lint.json finding, sorted blocking, major, minor
                                                                   ← if there are no findings, instead the single line: _No issues found._

## Ticket Hygiene                                                  ← only if hygiene.json exists
- <lint line>                                                      ← one per hygiene.json finding, sorted blocking, major, minor
                                                                   ← if there are no findings, instead the single line: _No issues found._
_Ticket status checked only against Jira's To Do category: no QA-ready statuses are recorded for <projectKey>._   ← only if statusCheck is "unrecorded"

## Verdict: <verdict>
```

Separate sections with one blank line. Format each lint line as the "Lint line" section of `${CLAUDE_PLUGIN_ROOT}/skills/qa-run/summary-template.md` describes (read it), then, if `suggestedQuestion` is present, append ` - _needs answering: <suggestedQuestion>_`.

Verdict, over the findings in both `lint.json` and `hygiene.json`, first match wins:
1. **`❌ Not ready to execute`** - any finding has `severity: "blocking"`.
2. **`✅ Ready to execute, with suggested improvements`** - any finding exists.
3. **`✅ Ready to execute`** - otherwise.

## 7. Report to the user

Print the full contents of `<run-dir>/lint.md` to the user (it's Markdown, formatted to paste into a ticket comment), and tell them the file path.

If there are `missing-context` findings, tell the user that `/qa-bot:qa-run <key>` asks those questions and saves the answers to `context/<projectKey>.md`, or that they can add the answers to that file themselves. If there are `external-access` findings, say that `/qa-bot:qa-run` will ask how to handle each such step before anything runs. If `hygiene.json` has `statusCheck: "unrecorded"`, tell the user to record the project's QA-ready statuses under `## Issue Tracker` in `context/<projectKey>.md` (e.g. `- QA-ready statuses: Ready for QA, In QA`), or run `/qa-bot:qa-lint` interactively once to be asked.

Then offer to post `lint.md` to the ticket, or post it, following "Posting the result to Jira" in `run-options.md`. Do not execute any QA step, and post nothing else to the issue tracker.

Finally, write `<run-dir>/result.json` with `status: "completed"`, the verdict as `outcome` and `commentId`, as `run-options.md` describes.
