# Ticket hygiene

Shared by the `qa-run` and `qa-lint` skills: check that the ticket itself is ready for QA, separately from its QA statement, and write `<run-dir>/hygiene.json`. Paths are relative to the current project root. Each **Non-interactive** rule applies only when `--non-interactive` was given (see `run-options.md`, beside this file).

Skip the check, writing no `hygiene.json`, unless `ticket.json` has `source: "jira-mcp"`.

## Fetch the ticket's state

Using the same Atlassian MCP server and site the ticket was fetched from, call `getJiraIssue` with `fields: ["status", "subtasks", "issuelinks"]` and `view: "evidence"` (the default view omits sub-tasks and links). From the response, take:
- the ticket's `status.name` and `status.statusCategory.name`,
- its **sub-tasks**: every `subtasks` entry,
- its **blockers**: every `issuelinks` entry whose `type.name` is `Blocks` and which has an `inwardIssue` (that issue blocks this one).

Linked issues come back with a status name but no status category, so if there are any sub-tasks or blockers, find the unfinished ones with one `searchJiraIssuesUsingJql` call: `jql: "key in (<keys>) AND statusCategory != Done"`, `fields: ["summary", "status"]`. If either call fails, skip the check, write no `hygiene.json`, and tell the user why when reporting.

## QA-ready statuses

The `## Issue Tracker` section of `context/<projectKey>.md` records which statuses mean a ticket is ready for QA, as `- QA-ready statuses: <status>, <status>`, or `- QA-ready statuses: not checked` if the team doesn't want the status checked. If neither is recorded, use `AskUserQuestion` to ask which statuses mean a `<projectKey>` ticket is ready for QA, saying which status `<key>` is in now. Offer the current status and **Don't check status**; the user can list several statuses via "Other". Record the answer, with a `Context Log` entry. **Non-interactive:** don't ask or record anything; check the status category only (below).

## Findings

Each failed check is a finding with `category: "ticket-hygiene"`, in the same shape as a `lint.json` finding:

| Check | Severity | `summary` | `suggestedFix` |
|---|---|---|---|
| QA-ready statuses are recorded, and the ticket's status isn't one of them (case-insensitive) | `blocking` | `Ticket is in status "<status>", not a QA-ready status (<QA-ready statuses>).` | `Move the ticket to a QA-ready status once the change is deployed for QA.` |
| No QA-ready statuses are recorded, and the ticket's status category is `To Do` | `blocking` | `Ticket is in status "<status>", which Jira categorises as To Do, so work on it hasn't started.` | `Move the ticket to a QA-ready status once the change is deployed for QA.` |
| An unfinished sub-task - one finding each | `major` | `Sub-task <key> (<summary>) is still "<status>".` | `Finish or descope the sub-task before QA.` |
| An unfinished blocker - one finding each | `major` | `Ticket is blocked by <key> (<summary>), which is still "<status>".` | `Resolve <key>, or remove the link if it no longer blocks this ticket.` |

Write `<run-dir>/hygiene.json`:

```json
{ "findings": [], "statusCheck": "checked" }
```

`statusCheck` is `"checked"`, `"disabled"` (recorded as `not checked`) or `"unrecorded"` (non-interactive with no QA-ready statuses recorded, so only the To Do category was checked).
