# qa-bot

Given a Jira ticket number, fetches its description and QA statement, lints the QA statement for clarity/consistency/missing context, executes it against a deployed app via Playwright MCP, and produces a results summary ready to paste into the Jira ticket.

## One-time setup

1. Install Node 18+ (this repo has no other dependencies).
2. Copy `.env.example` to `.env` and fill in:
   - `JIRA_EMAIL` — the email of the Jira account to query with.
   - `JIRA_API_TOKEN` — generate one at https://id.atlassian.com/manage-profile/security/api-tokens
   - Any per-project test credentials your team's `context/<PROJECT_KEY>.md` files reference (added over time, see below).
3. Edit `config/jira.config.json`:
   - Set `domain` to your real Jira Cloud domain (e.g. `yourcompany.atlassian.net`).
   - For each Jira project you'll run this against, add an entry under `projects` with either `qaStatementCustomField` (the custom field ID holding the QA statement, if your team uses one — e.g. `customfield_10050`) or `qaStatementHeading` (the heading text QA steps live under inside the description, e.g. `"QA Steps"`), or both (custom field tried first, heading used as a fallback if the field is empty).
   - Some projects don't use Jira's built-in description field at all — the ticket's real content lives in a custom field instead (e.g. a structured "Improvement Description" field). If so, set `descriptionCustomField` to that field's ID too. Find a field's ID by opening a ticket, inspecting the field's label element, and reading the `customfield_XXXXX` out of its `data-testid`.
4. In an interactive Claude Code session in this directory, run `/qa-run` once — it'll prompt to approve the project-scoped `.mcp.json` Playwright MCP server.

## Usage

```
/qa-run PROJ-123
```

This is interactive by design: if the QA statement is missing context the tool can't infer (deployment URL, login, test data), it'll ask you and save the answer to `context/PROJ.md` so future tickets in the same project don't need to ask again. Commit that file (it's git-tracked) so the whole team shares the same context — never put actual secret values in it, only the *name* of the `.env` variable that holds the secret.

Output lands in `runs/<TICKET-KEY>-<timestamp>/summary.md`, plus any failure screenshots alongside it in `screenshots/`. Nothing is posted back to Jira automatically — copy the summary into the ticket yourself.

## How it fits together

- `scripts/jira-fetch.mjs` — deterministic Jira REST API client; extracts description + QA statement.
- `scripts/adf-to-md.mjs` — converts Jira's Atlassian Document Format to Markdown.
- `.claude/agents/qa-linter.md` — subagent that reviews the QA statement for clarity, scope-consistency with the description, and missing context; severity-tags findings as `minor`/`major`/`blocking`.
- `.claude/agents/qa-executor.md` — subagent that drives Playwright MCP through the QA statement's steps against the real deployed app, screenshotting failures.
- `scripts/render-summary.mjs` — deterministic renderer that turns the linter's and executor's structured JSON output into the final Jira-paste-ready Markdown, including the accept/reject decision.
- `.claude/skills/qa-run/SKILL.md` — orchestrates all of the above, and is the only piece that talks to you directly (missing-context prompts, blocking-issue decisions).

See `/home/twj/.claude/plans/i-am-building-a-soft-thimble.md` for the full design write-up this was built from.
