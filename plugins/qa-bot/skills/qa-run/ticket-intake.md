# Ticket intake

Shared steps 1–3 for the `qa-run` and `qa-lint` skills: set up a run directory, load or create the project's QA context, and fetch the ticket into `<run-dir>/ticket.json`. All paths are relative to the current project root, except the sibling files referenced by name, which sit in the same directory as this file.

The skill's arguments carry the ticket key and optional flags, described in `run-options.md` (beside this file) - read it first. Each **Non-interactive** rule below applies only when `--non-interactive` was given; "stop" means stop as `run-options.md` describes.

## 1. Set up the run

Take `<key>` as the ticket key the skill was given (e.g. `PROJ-123`, `#412`, `ENG-77`). If it's missing, ask the user for it. **Non-interactive:** stop. Derive `<run-slug>` from `<key>` by replacing each run of characters other than letters, digits, `-` and `_` with `-` and trimming leading/trailing `-` (e.g. `acme/shop#412` → `acme-shop-412`).

Determine `<projectKey>`, which names this project's context files:
- If `<key>` looks like `ABC-123` (uppercase letters/digits, a dash, a number), it's the part before the dash.
- Otherwise, use `AskUserQuestion` to ask which project the ticket belongs to, offering the projects that already have a `context/<name>.md` file (ignore `*.app-notes.md`); the user can type a new one via "Other". It must be filesystem-safe - letters, digits, `-` and `_`.
- `--project <name>`, if given, takes precedence over both. **Non-interactive:** without it, a key not shaped like `ABC-123` stops the run.

Create the run directory `runs/<run-slug>-<timestamp>/`, where `<timestamp>` is the current time as `YYYY-MM-DDTHH-MM-SS` (colons replaced with dashes so it's filesystem-safe). If `--run-dir <path>` was given, use that path instead; it must not exist yet or be empty - otherwise stop rather than mixing two runs' files.

## 2. Load or create the project's shared QA context

Check whether `context/<projectKey>.md` exists.

- **If it exists**, read it - this is the shared context you'll use for fetching the ticket and pass to the subagents.
- **If it doesn't exist**, this is the first run for this project. **Non-interactive:** stop - the context file must be created by an interactive run and committed. Otherwise, use `AskUserQuestion` to ask for the essentials before proceeding:
  - Where is the system deployed for QA - the app URL for browser testing and/or the API base URL for API testing (staging URLs, or however environments are identified for this project)?
  - How does QA authenticate - a UI login and/or how API requests authenticate (e.g. a bearer token, an API key header, or a login endpoint that issues a token)? Usernames and other non-sensitive values can be given directly. For each secret (password, token, API key), ask only for the *name* of the env var that will hold it, suggesting a name such as `<PROJECTKEY>_STAGING_QA_PASSWORD` or `<PROJECTKEY>_STAGING_API_TOKEN`, and tell the user to add it to `.env` themselves - never ask them to paste the secret into chat.
  - Any test data or fixtures that generally need to exist before QA statements in this project can be run (optional - skip if not applicable)?

  Create `context/<projectKey>.md` from this template, filled in with the answers:
  ```markdown
  # QA Context - <PROJECT_KEY>

  ## Issue Tracker
  - None recorded yet.

  ## Environments
  - <answer>

  ## Test Data
  - <answer, or "None noted yet.">

  ## Known Gotchas
  - None noted yet.

  ## Context Log
  - <today's date>: initial context created (from <key> run)
  ```
  This file is meant to be git-tracked and shared with the team - mention that to the user once created, and remind them that each secret referenced by name here must be added to `.env` locally by each person running this tool, since `.env` itself isn't shared.

**Context conventions** (apply them whenever you write to this file):
- Secrets appear only as backtick-quoted `SCREAMING_SNAKE_CASE` env var names (e.g. ``password in `PROJ_STAGING_QA_PASSWORD` ``). Backtick-quoted `SCREAMING_SNAKE_CASE` tokens mean exactly that and nothing else.
- App and API URLs are always written out literally. The browser's navigate tool doesn't substitute secrets, so a URL given only as an env var name can't be visited. If an existing context file gives a URL only by env var name, ask the user for the literal URL (it isn't a secret), replace the reference, and add a `Context Log` entry. Mention that they can remove that var from `.env` - while it's there, Playwright MCP redacts that URL from page output. **Non-interactive:** stop instead.
- Persist only project-level, durable facts - what's expected to matter for future tickets in this project: environments, how to authenticate, standing test data or accounts, recurring gotchas. Anything specific to one ticket (a particular record or ID, a fixture only that ticket needs, how to read one of its steps) is used for the current run only and never written here.
- Keep entries short and high level: summarise rather than transcribe, and fold a new fact into an existing entry rather than adding a near-duplicate.
- Record facts in the section they belong to, and remove a section's `None … yet.` placeholder once it has a real entry.

## 3. Fetch the ticket

The goal of this step is `<run-dir>/ticket.json`:
```json
{ "key": "...", "projectKey": "...", "summary": "...", "description": "...", "qaStatement": "...", "source": "jira-mcp" }
```
`description` and `qaStatement` are Markdown. `source` is `"jira-mcp"` or `"manual"`.

If `--ticket-file <path>` was given, skip the routes below: read that file, a JSON object `{ "summary": "...", "description": "...", "qaStatement": "..." }` (`description` optional) whose text fields are Markdown or plain text. Stop if it's missing, isn't valid JSON, or lacks `summary` or `qaStatement`. Convert any HTML or ADF field following `rich-text-to-markdown.md` (beside this file), and write `ticket.json` with `"source": "manual"`.

**Non-interactive:** without `--ticket-file`, only route 3a is possible - wherever the rules below lead to 3b, stop instead.

Decide the route from the `## Issue Tracker` section of the context:
- **`Tracker: Jira`** → 3a, falling back to 3b if no Atlassian MCP tool is available.
- **Any other tracker recorded** → 3b.
- **Nothing recorded** → 3a if an Atlassian MCP tool is available and `<key>` looks like `ABC-123`; otherwise 3b. Once the tracker is known (3a succeeded, or the user said which tracker in 3b), record `- Tracker: <name>` under `## Issue Tracker`, with a `Context Log` entry.

### 3a. Jira via an Atlassian MCP connection

Look for a Jira issue tool from an Atlassian MCP server - a tool whose name ends in `getJiraIssue` (e.g. from the claude.ai Atlassian connector, or a user-configured Atlassian Rovo MCP server). Use `ToolSearch` with the query `getJiraIssue` if tools are deferred. If none exists, go to 3b.

The steps below describe the Atlassian Rovo MCP server's parameters and response shape. If the server you found takes different parameters, achieve the same result with what it offers.

1. **Site.** If `## Issue Tracker` records a `Site:` (a hostname such as `example.atlassian.net`), pass it as the `cloudId`. Otherwise call the server's `getAccessibleAtlassianResources`. If exactly one site is accessible, use it; if several are, ask the user which one (**non-interactive:** stop). Record `- Site: <hostname>`.
2. **Field mapping.** `## Issue Tracker` records where this project keeps the QA statement:
   - `- QA statement field: <customfield_XXXXX> (<display name>)` - a custom field holding the QA statement, and/or
   - `- QA statement heading: <heading text>` - a heading in the description that the QA steps sit under, and optionally
   - `- Description field: <customfield_XXXXX> (<display name>)` - a custom field holding the ticket's real description, for projects that don't use Jira's built-in description.

   If neither a QA statement field nor a heading is recorded, discover them: fetch the issue with `view: "evidence"`, which returns custom fields under `fields.customFields`, keyed by display name, each with its `id` and `value`. Find candidates (custom fields whose names suggest a QA statement/plan/test steps, or a matching heading in the description, and a custom field holding the description if the built-in one is empty), and confirm with `AskUserQuestion`, offering the candidates you found. Record the confirmed mapping, with a `Context Log` entry. **Non-interactive:** stop - the mapping must be recorded by an interactive run first.
3. **Fetch.** Call `getJiraIssue` with `fields` set to `summary`, `description` and the mapped custom field IDs, and `responseContentFormat: "markdown"`. Custom field values are under `fields.customFields`; match them by `id`. The server returns HTML instead of Markdown for any body holding content Markdown can't represent (`appliedContentFormat` says which you got). Convert anything that isn't plain text or Markdown following `rich-text-to-markdown.md` (beside this file) - read that file first.
4. **Extract.**
   - `description`: the description custom field if one is mapped and non-empty, otherwise the built-in description.
   - `qaStatement`: the QA statement field if one is mapped and non-empty. Otherwise, if a heading is mapped, the section of the description under that heading (case-insensitive match; the section runs until the next heading of the same or higher level). In that case, remove that section from `description`.
5. **Failures.** If the tool errors (not authenticated, no permission, ticket not found), report the error plainly. For authentication problems, tell the user to authenticate the Atlassian server via `/mcp`. If the tracker wasn't recorded yet and the ticket wasn't found, the project may simply not use Jira - say so. If no QA statement was found, say which field and/or heading you checked. In each case, offer the manual fallback (3b) or stopping (**non-interactive:** stop, with the error as the message). If no QA statement was found but the rest was fetched, the fallback only needs the QA statement.

Write `ticket.json` with `"source": "jira-mcp"`.

### 3b. Manual entry

Use this for projects on any other issue tracker, when no Atlassian MCP tool is available, or when the user chose it after a failure in 3a. If the project uses Jira (or the tracker isn't known yet), mention that connecting an Atlassian MCP server is the preferred path for Jira (e.g. the claude.ai Atlassian connector, or `claude mcp add --transport http atlassian https://mcp.atlassian.com/v2/mcp`). Don't mention it for projects on other trackers.

Use `AskUserQuestion` to confirm: **Enter the ticket details manually** or **Stop**. If the tracker isn't recorded yet, ask in the same call which issue tracker this project uses (e.g. Jira, GitHub Issues, Linear, Azure DevOps), so it's recorded and future runs go straight to the right route. If they stop, end here.

If this is a `qa-run` re-test (its step 0 found a previous run), offer in the same call to **reuse the previous run's ticket details** (its `ticket.json`) - the developer may not have amended the QA statement. If chosen, copy those fields and skip the rest of 3b.

Otherwise, ask in a plain message (the content is long free text, so don't use `AskUserQuestion` for it) for whatever 3a didn't already provide:
- the ticket **summary** (one line),
- the ticket **description** (optional, but without it the linter can't check the QA statement's scope against what was built),
- the **QA statement**.

The user may paste these directly or give a path to a file containing them; read the file if so. Keep their text verbatim, including links. If a pasted field is HTML or ADF, convert it following `rich-text-to-markdown.md` (beside this file). Write `ticket.json` with `"source": "manual"` and `"description": ""` if none was given.
