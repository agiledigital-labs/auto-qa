// Minimal Atlassian Document Format (ADF) -> Markdown walker.
// Covers the node/mark types that actually show up in Jira descriptions and
// QA statements: paragraph, heading, bulletList/orderedList/listItem, text
// (with bold/italic/code/link marks), codeBlock, rule, hardBreak, panel,
// media (images/attachments), and inline/block "smart links" (Jira's
// linked-issue and Confluence-page chips).
// Anything unrecognized is walked into for its text content so nothing is
// silently dropped, but unknown block types don't get special formatting.
//
// Media and smart links can't be rendered as real content (no vision pass on
// images here, and Jira only stores the URL for a smart link — the display
// title is resolved client-side, not present in the ADF) so both are turned
// into an explicit placeholder rather than silently vanishing. That gives the
// qa-linter something to flag ("this step depends on a mockup that isn't in
// the extracted text") instead of reasoning off text that's quietly missing
// a screenshot or a referenced ticket/style-guide link.

function markText(text, marks = []) {
  let out = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        out = `**${out}**`;
        break;
      case "em":
        out = `*${out}*`;
        break;
      case "code":
        out = `\`${out}\``;
        break;
      case "link":
        out = `[${out}](${mark.attrs?.href ?? ""})`;
        break;
      default:
        break;
    }
  }
  return out;
}

function renderSmartLink(attrs = {}) {
  const url = attrs.url ?? "";
  if (!url) return "";
  return `[linked reference](${url})`;
}

function renderMediaPlaceholder(mediaNode) {
  const attrs = mediaNode?.attrs ?? {};
  const label = attrs.alt || (attrs.type === "file" ? "attachment" : "image");
  return `_[${label} embedded here — not extracted; view in Jira]_`;
}

function renderInline(nodes = []) {
  return nodes
    .map((node) => {
      if (node.type === "text") return markText(node.text ?? "", node.marks);
      if (node.type === "hardBreak") return "\n";
      if (node.type === "mention") return `@${node.attrs?.text ?? node.attrs?.id ?? ""}`;
      if (node.type === "emoji") return node.attrs?.text ?? node.attrs?.shortName ?? "";
      if (node.type === "inlineCard") return renderSmartLink(node.attrs);
      if (node.type === "media") return renderMediaPlaceholder(node);
      if (node.content) return renderInline(node.content);
      return "";
    })
    .join("");
}

function renderBlock(node, listDepth = 0) {
  switch (node.type) {
    case "paragraph":
      return renderInline(node.content) + "\n\n";
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level ?? 1, 1), 6);
      return `${"#".repeat(level)} ${renderInline(node.content)}\n\n`;
    }
    case "bulletList":
      return (
        (node.content ?? [])
          .map((li) => renderListItem(li, "-", listDepth))
          .join("") + (listDepth === 0 ? "\n" : "")
      );
    case "orderedList":
      return (
        (node.content ?? [])
          .map((li, i) => renderListItem(li, `${i + 1}.`, listDepth))
          .join("") + (listDepth === 0 ? "\n" : "")
      );
    case "codeBlock": {
      const lang = node.attrs?.language ?? "";
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return "```" + lang + "\n" + code + "\n```\n\n";
    }
    case "rule":
      return "---\n\n";
    case "mediaSingle":
    case "mediaGroup":
      return (
        (node.content ?? [])
          .filter((c) => c.type === "media")
          .map((c) => renderMediaPlaceholder(c))
          .join("\n") + "\n\n"
      );
    case "media":
      return renderMediaPlaceholder(node) + "\n\n";
    case "blockCard":
    case "embedCard":
      return renderSmartLink(node.attrs) + "\n\n";
    case "panel":
      // Jira's colored callout boxes (used for "Why?"-style annotations) —
      // keep the contained text, drop only the visual styling.
      return (node.content ?? []).map((c) => renderBlock(c, listDepth)).join("");
    case "blockquote":
      return (
        (node.content ?? [])
          .map((c) => renderBlock(c, listDepth))
          .join("")
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    default:
      if (node.content) return node.content.map((c) => renderBlock(c, listDepth)).join("");
      return "";
  }
}

function renderListItem(listItem, marker, depth) {
  const indent = "  ".repeat(depth);
  const children = listItem.content ?? [];
  const [first, ...rest] = children;
  const firstText = first ? renderInline(first.content).trim() : "";
  let out = `${indent}${marker} ${firstText}\n`;
  for (const child of rest) {
    if (child.type === "bulletList" || child.type === "orderedList") {
      out += renderBlock(child, depth + 1);
    } else {
      out += `${indent}  ${renderInline(child.content).trim()}\n`;
    }
  }
  return out;
}

/**
 * Convert an ADF document (as returned by Jira's REST API v3, `description.content`
 * shape) into Markdown text.
 * @param {object} adfDoc - An ADF document node ({ type: "doc", content: [...] }) or null.
 * @returns {string}
 */
export function adfToMarkdown(adfDoc) {
  if (!adfDoc || !Array.isArray(adfDoc.content)) return "";
  return adfDoc.content
    .map((node) => renderBlock(node))
    .join("")
    .trim();
}
