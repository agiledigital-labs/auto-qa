# Rich text → Markdown conversion rules

Ticket fields don't always arrive as Markdown. The Atlassian MCP server returns HTML for any rich-text field holding content Markdown can't represent (emoji, media, panels, mentions), and other sources may return HTML or Atlassian Document Format (ADF: a JSON object with `"type": "doc"` and a `content` array). Users may also paste either. Convert to Markdown faithfully - never summarise, reword, or drop content. Plain text and Markdown are used as-is (trimmed).

## Structure

| HTML | ADF | Markdown |
|---|---|---|
| `<p>` | `paragraph` | Its inline content, followed by a blank line. |
| `<h1>`–`<h6>` | `heading` (`attrs.level`) | `#` × level, a space, then the inline content. |
| `<ul>` / `<ol>` / `<li>` | `bulletList` / `orderedList` / `listItem` | `-` or `1.`, `2.`, … per item; nested lists indented two spaces per level. An item's first paragraph goes on the marker line. |
| `<pre><code>` | `codeBlock` (`attrs.language`) | A fenced block, with the language tag if known. |
| `<hr>` | `rule` | `---` |
| `<blockquote>` | `blockquote` | Each line prefixed with `> `. |
| `<table>` / `<tr>` / `<th>` / `<td>` | `table` / `tableRow` / `tableHeader` / `tableCell` | A Markdown table; the first row is the header row. |
| Panels, expands, layout containers (`<div>` wrappers) | `panel`, `expand`, `layoutSection`, … | Their contained content only - drop the styling, keep the text. |
| Anything else | Anything else | Its text content, so nothing is lost. |

## Inline

| HTML | ADF | Markdown |
|---|---|---|
| `<strong>` / `<em>` / `<code>` / `<s>` | marks `strong` / `em` / `code` / `strike` | `**text**` / `*text*` / `` `text` `` / `~~text~~` |
| `<a href>` | mark `link` (`attrs.href`) | `[text](href)` - keep the URL verbatim. |
| `<br>` | `hardBreak` | A newline. |
| A mention (e.g. `data-type="mention"`) | `mention` | `@` + the displayed name. |
| An emoji (e.g. `data-type="emoji"`) | `emoji` | The emoji's text (e.g. `:info:`), or drop it if it's purely decorative in a heading. |
| A smart link / inline card (an element carrying the URL but no meaningful title) | `inlineCard` / `blockCard` / `embedCard` | The **smart-link placeholder** (below). |
| `<img>`, media elements | `media`, `mediaSingle`, `mediaGroup`, `mediaInline` | The **media placeholder** (below), one per image or attachment. |

Ignore attributes that carry no content (`data-local-id`, styling classes).

## Placeholders

Images can't be viewed here, and a smart link's display title isn't part of the stored content. Never drop them silently: `qa-linter` relies on these placeholders to flag steps that depend on content missing from the text.

- **Media placeholder:** `_[<label> embedded here - not extracted; view in the ticket]_`, where `<label>` is the image's alt text if present, otherwise `attachment` for a file, otherwise `image`.
- **Smart-link placeholder:** `[linked reference](<url>)`. Omit it entirely if there is no URL.
