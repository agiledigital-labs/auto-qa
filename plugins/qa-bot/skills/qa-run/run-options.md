# Run options and results

Shared by the `qa-run` and `qa-lint` skills.

## Arguments

The skill's arguments are a ticket key followed by optional flags, in any order:

| Flag | Meaning |
|---|---|
| `--non-interactive` | Run unattended, e.g. in CI/CD. See below. |
| `--project <name>` | The project key, for ticket keys not shaped like `ABC-123` (intake step 1). |
| `--ticket-file <path>` | Read the ticket from a JSON file instead of fetching it (intake step 3). |
| `--run-dir <path>` | Write the run to this directory instead of `runs/<run-slug>-<timestamp>/` (intake step 1). |
| `--extras <list>` | `qa-run` only: comma-separated optional extras - `regression`, `exploratory`, `accessibility` (step 4). |
| `--post-comment` | Post the report to the Jira ticket as a comment (see "Posting the result to Jira"). |
| `--retest [<path>]` | `qa-run` only: re-test the ticket against a previous run - the run directory at `<path>` if given (the next argument, when it doesn't start with `--`), otherwise the most recent one found (step 0). |

Every flag except `--non-interactive` works in either mode; interactively, each one answers its question in advance. An unknown flag, or a flag missing its value, stops the run (below).

## Non-interactive mode

No one is watching and no one can answer. Never call `AskUserQuestion`, never ask anything in a plain message, and never end your turn waiting for a reply. Wherever a step says to ask, confirm or offer something, follow that step's **Non-interactive** rule instead. If a step has no such rule and you would need an answer to continue, stop.

Pipelines allowlist only the commands the steps give, so write files with the `Write` tool rather than shell redirection or heredocs, and use `Bash` only for those commands.

Don't modify `context/<projectKey>.md` in this mode - a pipeline's workspace is thrown away, and edits there would drift from the team's shared copy. That includes recording a tracker, Atlassian site or field mapping. (`qa-executor` still updates the app notes; whether the pipeline keeps them is up to the pipeline.)

Secrets reach the two surfaces differently: the Playwright MCP server reads them from `.env`, and `qa-executor`'s `curl` requests read them from the process environment, so the pipeline must provide both.

## Stopping

To stop the run early - in either mode - write `<run-dir>/result.json` with `status: "stopped"` (if `<run-dir>` exists yet), tell the user why, and end. In non-interactive mode, the `message` must say what would let the run succeed (e.g. "context/PROJ.md doesn't exist - create it with an interactive run and commit it").

## Posting the result to Jira

By default the report (`summary.md` or `lint.md`) is printed for the user to paste. It's posted as a comment on the ticket only when all of these hold:

- The project uses Jira: `Tracker: Jira` is recorded in the context, or this run fetched the ticket through an Atlassian MCP server.
- A tool whose name ends in `addOrEditJiraIssueComment` is available (use `ToolSearch` if tools are deferred).
- The user opted in: `--post-comment` was given, or - interactively, without the flag - they answered yes when asked, after the report was printed, whether to post it to `<key>`. Ask only when the first two hold. **Non-interactive:** post only with `--post-comment`.

If `--post-comment` was given but the first two don't hold, don't post, and say why.

To post:

1. **Site.** Use the site the ticket was fetched from, else the `Site:` recorded in the context, else call `getAccessibleAtlassianResources`: use the only site, or if there are several, ask which (**non-interactive:** don't post; say why).
2. **Body.** The report as Markdown, with two changes. Replace each link to a local file (screenshots, saved responses) with its link text and the path in backticks, e.g. ``(screenshot: `screenshots/step-2-login-failure.png`)``, since those files aren't uploaded. Then append a final line: ``_Posted by qa-bot. Evidence files are kept locally in `<run-dir>`._``. Never attach screenshots or saved responses - they can contain tokens or personal data.
3. **Post.** Call the tool with `cloudId`, `issueIdOrKey: <key>` and `commentBody`, without `commentId`, so it always adds a new comment - each run and re-test adds its own. Tell the user it was posted, and keep the returned comment ID for `result.json`.

If the call fails, report the error plainly (for authentication problems, tell the user to authenticate the Atlassian server via `/mcp`). A failed or skipped post doesn't stop the run or change its outcome. Never edit or delete comments, and never change anything else on the ticket.

## result.json

Every run that creates `<run-dir>` ends by writing `<run-dir>/result.json`, in either mode, so a pipeline can read the outcome:

```json
{ "skill": "qa-run", "key": "PROJ-123", "status": "completed", "outcome": "accept-with-follow-ups", "retestOf": null, "commentId": null, "message": null }
```

- `status`: `"completed"`, or `"stopped"` if the run ended early.
- `outcome`: `null` when stopped. Otherwise, for `qa-run`, the decision from `summary.md` - `"accept"`, `"accept-with-follow-ups"` or `"reject"`; for `qa-lint`, the verdict from `lint.md` - `"ready"`, `"ready-with-improvements"` or `"not-ready"`.
- `retestOf`: `qa-run` only - the previous run directory this run re-tested, otherwise `null`.
- `commentId`: the Jira comment ID if the report was posted, otherwise `null`.
- `message`: why the run stopped, or why a requested comment wasn't posted; otherwise `null`.
