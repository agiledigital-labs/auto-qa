# Rendering `summary.md`

Build `<run-dir>/summary.md` from `ticket.json`, `lint.json` (treat as `{ "findings": [] }` if absent), `hygiene.json` (none if absent) and `execution.json` (treat as `{ "steps": [] }` if absent), plus `retest.json` if present. Follow this exactly - the output is pasted into the ticket as a comment, so consistency across runs matters more than prose quality. Copy `summary`, `stepText` and `notes` text verbatim; do not reword, merge or editorialise.

## Inputs

- `findings` = `lint.findings`
- `hygiene` = `hygiene.json`, or none if absent
- `hygieneFindings` = `hygiene.findings` (default `[]`)
- `steps` = `execution.steps`
- `exploration` = `execution.explorationFindings` (default `[]`)
- `accessibility` = `execution.accessibilityFindings` (default `[]`)
- `allSteps` = `steps` + `exploration` + `accessibility`
- `retest` = `retest.json`, or none if absent

## Decision

Evaluate in order; the first match wins:

1. **`❌ Reject`** - any entry in `findings` or `hygieneFindings` has `severity: "blocking"`, or any entry in `allSteps` has `status: "fail"` and `severity: "blocking"`.
2. **`✅ Accept with follow-ups`** - any entry in `allSteps` has `status: "fail"`.
3. **`✅ Accept`** - otherwise.

## Layout

Sections in this order. Omit any section marked *(only if …)* when its condition is false. Separate sections with one blank line.

```markdown
# QA Results - <ticket.key>

_QA statement supplied manually, not fetched from the issue tracker._   ← only if ticket.source is "manual"

_Re-test of `<retest.previousRunDir>` (previous decision: <previous decision>). Every step of the current QA statement was executed again._   ← only if retest exists

## QA Statement / Ticket Review                                    ← only if findings is non-empty
- <lint line>                                                      ← one per finding, sorted blocking, major, minor

## Ticket Hygiene                                                  ← only if hygieneFindings is non-empty or hygiene.statusCheck is "unrecorded"
- <lint line>                                                      ← one per hygieneFindings entry, sorted blocking, major, minor
_Ticket status checked only against Jira's To Do category: no QA-ready statuses are recorded for <ticket.projectKey>._   ← only if hygiene.statusCheck is "unrecorded"

## QA Steps
- <step line>                                                      ← one per entry in steps, in order
                                                                   ← if steps is empty, instead the single line: _Execution was not run for this ticket._

## Changes Since Previous Run                                      ← only if retest exists
- <retest line>                                                    ← one per retest.steps entry that isn't "passed again", in order, then one per removedSteps entry
- <n> step(s) passed again.                                        ← only if n > 0

## Exploratory Testing                                             ← only if exploration is non-empty
- <step line>

## Accessibility/UX Testing                                        ← only if accessibility is non-empty
- <step line>

## Regression Test                                                 ← only if execution.regressionScriptPath is set
A reusable regression script was generated: `<regressionScriptPath>`. Run it later with `<run command>`.

## Decision: <decision>

### Suggested follow-ups (non-blocking)                             ← only if there is at least one follow-up
- <follow-up>
```

### Previous decision

`retest.previousOutcome` rendered as a decision: `accept` → `✅ Accept`, `accept-with-follow-ups` → `✅ Accept with follow-ups`, `reject` → `❌ Reject`; if it's missing, `unknown`.

### Retest line

By `previousStatus` → `status`, first match wins:

| Change | Line |
|---|---|
| `previousStatus` is `null` | `- 🆕 New or amended: <stepText> - now <status>` |
| `fail` → `pass` | `- 🔧 Fixed: <stepText>` |
| `fail` → `fail` | `- ❌ Still failing: <stepText>` |
| `pass` → `fail` | `- ⚠️ Regressed (passed previously): <stepText>` |
| `pass` → `pass` | not listed; counted as "passed again" |
| any other pair (`not-run` involved) | `- ⏭️ <stepText> - was <previousStatus>, now <status>` |
| a `removedSteps` entry | `- 🗑️ Removed: <text>` |

### Run command

By `regressionScriptPath`'s extension: `.spec.ts` → `npx playwright test <regressionScriptPath>`; `.test.mjs` → `node --test <regressionScriptPath>`. Write `regressionScriptPath` relative to the project root.

### Lint line

`- <emoji> *(<severity>, <category>)* <summary>` - then, if `suggestedFix` is present, append ` - _suggested fix: <suggestedFix>_`.

Emoji by severity: `blocking` 🔴, `major` 🟠, `minor` 🟡.

### Step line

| Entry | Line |
|---|---|
| `status: "pass"` | `- ✅ <stepText>` - then ` - <notes>` if `notes` is present. |
| `status: "not-run"` | `- ⏭️ <stepText> - not run: <notes, or "blocked by an earlier failure">` |
| `status: "fail"`, `severity: "minor"` | `- ⚠️ <stepText> - **minor**: <notes, or "failed">` |
| `status: "fail"`, other severity | `- ❌ <stepText> - **<severity>**: <notes, or "failed">` |

For a `fail` entry, append its evidence, with paths relative to the run directory:
- `screenshotPath` → ` ([screenshot](screenshots/step-2-login-failure.png))`
- `responsePath` → ` ([response](responses/step-3-create-order.txt))`

### Follow-ups

`<stepText>: <notes>` for every entry in `allSteps` with `status: "fail"` and a severity other than `blocking`, in `allSteps` order. Follow-ups cover execution results only; lint findings are not repeated here, as they're already listed under QA Statement / Ticket Review.
