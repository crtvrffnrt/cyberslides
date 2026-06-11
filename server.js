const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const pty = require("node-pty");

const fsp = fs.promises;
const rootDir = __dirname;
const parentDir = path.resolve(rootDir, "..");
const contentDir = path.join(rootDir, "content");
const localNodeModulesDir = path.join(rootDir, "node_modules");
const parentNodeModulesDir = path.join(parentDir, "node_modules");
const templatePath = path.join(rootDir, "index.template.html");
const configPath = path.join(rootDir, "presentation.config.json");
const clientPath = path.join(rootDir, "client.js");
const minSlides = 1;
const maxSlides = 100;
const maxRequestBytes = 30 * 1024 * 1024;
const websocketHeartbeatMs = 15000;
const shutdownGraceMs = 1500;
const debugEnabled = process.env.PRESENTATION_DEBUG === "1" || process.env.NODE_ENV === "development";
const allowedTemplateTypes = new Set(["cover", "terminalText", "text", "image", "terminalFocused", "dense"]);
const allowedPayloadKeys = new Set(["config", "contentSlides"]);
const allowedConfigKeys = new Set(["title", "theme", "defaults", "cover", "metadata", "presenter", "slides", "contentSlides"]);
const allowedThemeKeys = new Set(["background", "foreground", "muted", "accent"]);
const allowedDefaultsKeys = new Set(["textScale", "headingScale", "bodyScale", "terminal"]);
const allowedTerminalThemeKeys = new Set(["background", "foreground", "cursor", "selectionBackground"]);
const allowedDefaultTerminalKeys = new Set(["shell", "cwd", "fontSize", "theme"]);
const allowedCoverKeys = new Set(["kicker", "subtitle", "title", "agendaTitle", "agenda"]);
const allowedMetadataKeys = new Set(["date", "version"]);
const allowedPresenterKeys = new Set(["name", "role", "contact", "website", "github", "linkedin"]);
const allowedSlideKeys = new Set(["type", "layout", "terminal", "mustReadUrl", "image", "headingScale", "bodyScale", "textScale"]);
const allowedTerminalKeys = new Set(["enabled", "leftVw", "topVh", "widthVw", "heightVh", "position", "title", "shell", "cwd", "fontSize", "theme"]);
const allowedImageKeys = new Set(["src", "alt", "x", "y", "scale"]);
const allowedLayouts = new Set(["cover", "hero", "center"]);
const terminalTemplateGeometry = {
  terminalText: {
    leftVw: 46,
    topVh: 10,
    widthVw: 48,
    heightVh: 83
  },
  terminalFocused: {
    leftVw: 7,
    topVh: 9,
    widthVw: 86,
    heightVh: 78
  }
};

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
  [".m4a", "audio/mp4"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".ico", "image/x-icon"],
  [".map", "application/json; charset=utf-8"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

const allowedAudioExtensions = new Set([".mp3", ".wav", ".flac", ".ogg", ".m4a"]);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(text) {
  const tokens = [];
  let safe = escapeHtml(text);

  safe = safe.replace(/`([^`]+)`/g, (_, code) => {
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

  return safe.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function codeFenceLanguage(line) {
  const match = String(line || "").match(/^```+\s*([^\s`]+)?/);
  return match && match[1] ? match[1].toLowerCase() : "";
}

function normalizeInlineHtmlMarkup(text) {
  return String(text ?? "")
    .replace(/<\s*\/?\s*strong\s*>/gi, (match) => (match.includes("/") ? "**" : "**"))
    .replace(/<\s*\/?\s*b\s*>/gi, (match) => (match.includes("/") ? "**" : "**"))
    .replace(/<\s*\/?\s*em\s*>/gi, (match) => (match.includes("/") ? "*" : "*"))
    .replace(/<\s*\/?\s*i\s*>/gi, (match) => (match.includes("/") ? "*" : "*"))
    .replace(/<\s*\/?\s*code\s*>/gi, (match) => (match.includes("/") ? "`" : "`"))
    .replace(/<\s*br\s*\/?\s*>/gi, "\n");
}

function sanitizeMarkdownUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("#") || value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value.startsWith("?")) {
    return value;
  }

  try {
    const parsed = new URL(value, "http://example.invalid");
    if (["http:", "https:", "mailto:", "tel:", "ftp:"].includes(parsed.protocol)) {
      return value;
    }
  } catch {
    return "";
  }

  return "";
}

function inlineMarkdown(text) {
  const normalized = normalizeInlineHtmlMarkup(text);
  const tokens = [];
  let safe = escapeHtml(normalized);

  safe = safe.replace(/`([^`]+)`/g, (_, code) => {
    tokens.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${tokens.length - 1}\u0000`;
  });

  safe = safe.replace(/\[([^[\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeMarkdownUrl(href);
    const renderedLabel = label.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
    if (!safeHref) {
      return renderedLabel;
    }
    return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer">${renderedLabel}</a>`;
  });

  safe = safe.replace(/(^|[^*])\*\*([^*]+)\*\*(?!\*)/g, "$1<strong>$2</strong>");
  safe = safe.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

  return safe.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function renderMermaidBlock(code) {
  return `<div class="mermaid-diagram"><div class="mermaid-source"><pre><code>${escapeHtml(code)}</code></pre></div></div>`;
}

function highlightCodeToken(token, type) {
  return `<span class="token-${type}">${escapeHtml(token)}</span>`;
}

function highlightCode(code, language) {
  const source = String(code ?? "");
  const lang = String(language || "").toLowerCase();
  const patterns = [];

  const genericKeywords = [
    "async", "await", "break", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
    "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "import",
    "in", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static",
    "super", "switch", "this", "throw", "true", "try", "type", "typeof", "undefined", "var", "void", "while",
    "with", "yield"
  ];

  if (["bash", "sh", "shell", "zsh"].includes(lang)) {
    patterns.push(
      { type: "comment", regex: /#[^\n\r]*/g },
      { type: "string", regex: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g },
      { type: "variable", regex: /\$[A-Za-z_][A-Za-z0-9_]*|\$\{[^}]+\}/g },
      { type: "keyword", regex: /\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|function|local|export|readonly|return|break|continue|in|select|time|until|test)\b/g },
      { type: "number", regex: /\b\d+(?:\.\d+)?\b/g }
    );
  } else if (lang === "json") {
    patterns.push(
      { type: "string", regex: /"(?:[^"\\]|\\.)*"/g },
      { type: "boolean", regex: /\b(?:true|false|null)\b/g },
      { type: "number", regex: /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g },
      { type: "punctuation", regex: /[{}\[\],:]/g }
    );
  } else {
    patterns.push(
      { type: "comment", regex: /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g },
      { type: "string", regex: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g },
      { type: "number", regex: /\b\d+(?:\.\d+)?\b/g },
      { type: "keyword", regex: new RegExp(`\\b(?:${genericKeywords.join("|")})\\b`, "g") }
    );
  }

  const combined = new RegExp(patterns.map((pattern, index) => `(?<t${index}>${pattern.regex.source})`).join("|"), "g" + (patterns.some((pattern) => pattern.regex.ignoreCase) ? "i" : ""));
  let lastIndex = 0;
  let rendered = "";
  let match;

  while ((match = combined.exec(source))) {
    const index = match.index;
    if (index > lastIndex) {
      rendered += escapeHtml(source.slice(lastIndex, index));
    }

    const token = match[0];
    let type = "text";
    for (let i = 0; i < patterns.length; i += 1) {
      if (match.groups && match.groups[`t${i}`] !== undefined) {
        type = patterns[i].type;
        break;
      }
    }

    rendered += highlightCodeToken(token, type);
    lastIndex = index + token.length;
  }

  if (lastIndex < source.length) {
    rendered += escapeHtml(source.slice(lastIndex));
  }

  return rendered;
}

function renderCopyButton(text, label = "Copy") {
  return `<button class="markdown-copy-button" type="button" data-copy-text="${escapeHtml(String(text ?? ""))}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
}

function renderCodeBlock(code, language) {
  const className = language ? ` class="language-${escapeHtml(language)}"` : "";
  return `<div class="markdown-code-block">${renderCopyButton(code)}<pre><code${className}>${highlightCode(code, language)}</code></pre></div>`;
}

function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !String(lines[start] || "").trim()) {
    start += 1;
  }
  while (end > start && !String(lines[end - 1] || "").trim()) {
    end -= 1;
  }
  return lines.slice(start, end);
}

function renderMarkdownFragment(markdown) {
  const html = renderMarkdown(markdown);
  if (/^<p>[\s\S]*<\/p>$/.test(html) && !html.includes("\n")) {
    return html.slice(3, -4);
  }
  return html;
}

function isHorizontalRule(line) {
  return /^(?: {0,3})(?:-{3,}|\*{3,}|_{3,})(?:\s*)$/.test(String(line || ""));
}

function isTableDelimiterRow(line) {
  const cells = String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tableCellAlignment(cell) {
  if (/^:-+:$/.test(cell)) {
    return "center";
  }
  if (/^-+:$/.test(cell)) {
    return "right";
  }
  if (/^:-+$/.test(cell)) {
    return "left";
  }
  return "";
}

function renderTableBlock(lines, startIndex) {
  const headerLine = lines[startIndex];
  const delimiterLine = lines[startIndex + 1];
  if (!headerLine || !delimiterLine || !headerLine.includes("|") || !isTableDelimiterRow(delimiterLine)) {
    return null;
  }

  const headerCells = splitTableRow(headerLine);
  const delimiterCells = splitTableRow(delimiterLine);
  const alignments = delimiterCells.map(tableCellAlignment);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length) {
    const line = lines[index];
    if (!String(line || "").trim() || !line.includes("|")) {
      break;
    }
    rows.push(splitTableRow(line));
    index += 1;
  }

  const headerMarkup = headerCells
    .map((cell, cellIndex) => {
      const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]}"` : "";
      return `<th${align}>${inlineMarkdown(cell)}</th>`;
    })
    .join("");

  const bodyMarkup = rows
    .map((row) => {
      const cells = row
        .map((cell, cellIndex) => {
          const align = alignments[cellIndex] ? ` style="text-align:${alignments[cellIndex]}"` : "";
          return `<td${align}>${inlineMarkdown(cell)}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return {
    html: `<div class="markdown-table"><table><thead><tr>${headerMarkup}</tr></thead><tbody>${bodyMarkup}</tbody></table></div>`,
    nextIndex: index
  };
}

function parseDetailsSummary(lines, startIndex) {
  const firstLine = String(lines[startIndex] || "").trim();
  const inlineSummaryMatch = firstLine.match(/^<summary[^>]*>([\s\S]*?)<\/summary>$/i);
  if (inlineSummaryMatch) {
    return {
      summary: inlineMarkdown(inlineSummaryMatch[1].trim()) || "Details",
      nextIndex: startIndex + 1
    };
  }

  const openSummaryMatch = firstLine.match(/^<summary[^>]*>([\s\S]*)$/i);
  if (!openSummaryMatch) {
    return null;
  }

  const summaryLines = [];
  let index = startIndex;
  let pending = openSummaryMatch[1];
  if (pending) {
    summaryLines.push(pending);
  }

  while (index + 1 < lines.length) {
    index += 1;
    const current = String(lines[index] || "");
    const closeSummaryIndex = current.toLowerCase().indexOf("</summary>");
    if (closeSummaryIndex >= 0) {
      const beforeClose = current.slice(0, closeSummaryIndex);
      if (beforeClose.trim()) {
        summaryLines.push(beforeClose);
      }
      return {
        summary: inlineMarkdown(summaryLines.join("\n").trim()) || "Details",
        nextIndex: index + 1
      };
    }
    summaryLines.push(current);
  }

  return {
    summary: inlineMarkdown(summaryLines.join("\n").trim()) || "Details",
    nextIndex: lines.length
  };
}

function renderDetailsBlock(lines, startIndex) {
  if (!String(lines[startIndex] || "").trim().match(/^<details(?:\s[^>]*)?>$/i)) {
    return null;
  }

  let index = startIndex + 1;
  const bodyLines = [];
  let summary = "Details";

  while (index < lines.length) {
    const current = String(lines[index] || "");
    if (current.trim().toLowerCase() === "</details>") {
      const body = trimBlankEdges(bodyLines).join("\n");
      return {
        html: `<details class="markdown-details"><summary><span class="markdown-details-title">${summary}</span>${renderCopyButton(body)}</summary>${body ? `<div class="markdown-details-body">${renderMarkdown(body)}</div>` : ""}</details>`,
        nextIndex: index + 1
      };
    }

    if (current.trim().toLowerCase().startsWith("<summary")) {
      const parsedSummary = parseDetailsSummary(lines, index);
      if (parsedSummary) {
        summary = parsedSummary.summary;
        index = parsedSummary.nextIndex;
        continue;
      }
    }

    bodyLines.push(current);
    index += 1;
  }

  const body = trimBlankEdges(bodyLines).join("\n");
  return {
    html: `<details class="markdown-details"><summary><span class="markdown-details-title">${summary}</span>${renderCopyButton(body)}</summary>${body ? `<div class="markdown-details-body">${renderMarkdown(body)}</div>` : ""}</details>`,
    nextIndex: lines.length
  };
}

function renderListBlock(lines, startIndex) {
  const firstLine = String(lines[startIndex] || "");
  const unorderedMatch = firstLine.match(/^( {0,3})([-*+])\s+(.*)$/);
  const orderedMatch = firstLine.match(/^( {0,3})(\d+)[.)]\s+(.*)$/);

  if (!unorderedMatch && !orderedMatch) {
    return null;
  }

  const isOrdered = !!orderedMatch;
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = String(lines[index] || "");
    const match = isOrdered
      ? line.match(/^( {0,3})(\d+)[.)]\s+(.*)$/)
      : line.match(/^( {0,3})([-*+])\s+(.*)$/);

    if (!match) {
      break;
    }

    const itemLines = [match[3]];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const continuation = String(lines[nextIndex] || "");
      if (!continuation.trim()) {
        itemLines.push("");
        nextIndex += 1;
        continue;
      }

      if (continuation.match(/^( {0,3})([-*+])\s+/) || continuation.match(/^( {0,3})(\d+)[.)]\s+/) || isHorizontalRule(continuation) || continuation.trim().startsWith("```") || continuation.trim().startsWith("<details>") || continuation.trim().startsWith("|")) {
        break;
      }

      if (/^\s{2,}/.test(continuation)) {
        itemLines.push(continuation.replace(/^\s{2,}/, ""));
        nextIndex += 1;
        continue;
      }

      break;
    }

    items.push(itemLines.join("\n"));
    index = nextIndex;
  }

  const renderedItems = items.map((item) => {
    const taskMatch = item.match(/^\[( |x|X)\]\s+([\s\S]*)$/);
    if (!taskMatch) {
      return `<li>${renderMarkdownFragment(item)}</li>`;
    }

    const checked = taskMatch[1].toLowerCase() === "x";
    const content = renderMarkdownFragment(taskMatch[2]);
    return `<li class="task-list-item"><label><input type="checkbox" disabled${checked ? " checked" : ""} /><span>${content}</span></label></li>`;
  });

  const tagName = isOrdered ? "ol" : "ul";
  const className = !isOrdered && renderedItems.some((item) => item.includes("task-list-item")) ? ' class="task-list"' : "";
  return {
    html: `<${tagName}${className}>${renderedItems.join("")}</${tagName}>`,
    nextIndex: index
  };
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const parts = [];
  let i = 0;

  const flushParagraph = (buffer) => {
    if (!buffer.length) {
      return;
    }
    parts.push(`<p>${buffer.map((line) => inlineMarkdown(line)).join("<br />")}</p>`);
    buffer.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.match(/^<details(?:\s[^>]*)?>$/i)) {
      const block = renderDetailsBlock(lines, i);
      if (block) {
        parts.push(block.html);
        i = block.nextIndex;
        continue;
      }
    }

    if (isHorizontalRule(trimmed)) {
      parts.push("<hr />");
      i += 1;
      continue;
    }

    const tableBlock = renderTableBlock(lines, i);
    if (tableBlock) {
      parts.push(tableBlock.html);
      i = tableBlock.nextIndex;
      continue;
    }

    const listBlock = renderListBlock(lines, i);
    if (listBlock) {
      parts.push(listBlock.html);
      i = listBlock.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      parts.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      parts.push(`<blockquote>${inlineMarkdown(quote.join(" "))}</blockquote>`);
      continue;
    }

    if (line.startsWith("```")) {
      const language = codeFenceLanguage(line);
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      const codeText = code.join("\n");
      parts.push(language === "mermaid" ? renderMermaidBlock(codeText) : renderCodeBlock(codeText, language));
      continue;
    }

    const buffer = [];
    while (i < lines.length) {
      const nextLine = lines[i];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || nextLine.match(/^(#{1,6})\s+/) || nextLine.startsWith(">") || nextLine.startsWith("```") || isHorizontalRule(nextTrimmed) || nextTrimmed.match(/^<details(?:\s[^>]*)?>$/i) || nextTrimmed.startsWith("<summary") || nextTrimmed.startsWith("|") || nextLine.match(/^( {0,3})([-*+])\s+/) || nextLine.match(/^( {0,3})(\d+)[.)]\s+/)) {
        break;
      }
      buffer.push(nextLine.trim());
      i += 1;
    }
    flushParagraph(buffer);
  }

  return parts.join("\n");
}

function debugLog(...args) {
  if (debugEnabled) {
    console.error("[presentation]", ...args);
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validationError(message) {
  return httpError(400, message);
}

function sanitizeAssetStem(value) {
  return String(value || "image")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

function mimeTypeToExtension(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/avif":
      return ".avif";
    default:
      return "";
  }
}

function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function parseDataImageUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    throw validationError("Invalid image data URL.");
  }

  const mimeType = match[1].toLowerCase();
  const body = match[2].replace(/\s+/g, "");
  let buffer;
  try {
    buffer = Buffer.from(body, "base64");
  } catch {
    throw validationError("Invalid image data URL.");
  }

  if (!buffer.length) {
    throw validationError("Invalid image data URL.");
  }

  return { mimeType, buffer };
}

function contentAssetUrlToPath(src) {
  if (typeof src !== "string" || !src.startsWith("/content/")) {
    return null;
  }

  const assetPath = confinedPath(rootDir, src);
  if (!assetPath) {
    return null;
  }

  const relative = path.relative(contentDir, assetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return assetPath;
}

function collectImageSources(config) {
  const sources = new Set();
  const slides = Array.isArray(config?.slides) ? config.slides : [];
  for (const slide of slides) {
    const src = slide?.image?.src;
    if (typeof src === "string" && src) {
      sources.add(src);
    }
  }

  return sources;
}

async function writeImageAssetFromDataUrl(dataUrl, fallbackName, slideIndex) {
  const { mimeType, buffer } = parseDataImageUrl(dataUrl);
  await fsp.mkdir(contentDir, { recursive: true });

  const extension = mimeTypeToExtension(mimeType) || ".bin";
  const stem = sanitizeAssetStem(fallbackName || `slide-${slideIndex + 1}`);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const fileName = `${stem}-${suffix}${extension}`;
    const filePath = path.join(contentDir, fileName);
    try {
      await fsp.writeFile(filePath, buffer, { flag: "wx" });
      return `/content/${fileName}`;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw httpError(500, "Failed to allocate image asset name.");
}

async function materializeImageAssets(config) {
  const nextConfig = JSON.parse(JSON.stringify(config));
  const slides = Array.isArray(nextConfig.slides) ? nextConfig.slides : [];
  let changed = false;

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    if (!slide?.image || typeof slide.image !== "object") {
      continue;
    }

    const src = slide.image.src;
    if (!isDataImageUrl(src)) {
      continue;
    }

    const assetSrc = await writeImageAssetFromDataUrl(src, slide.image.alt || slide.type || "image", index);
    slide.image.src = assetSrc;
    changed = true;
  }

  return { config: nextConfig, changed };
}

async function deleteUnusedContentAssets(previousConfig, nextConfig) {
  const previousSources = collectImageSources(previousConfig);
  const nextSources = collectImageSources(nextConfig);
  const staleSources = Array.from(previousSources).filter((src) => !nextSources.has(src));
  const deletions = staleSources
    .map((src) => contentAssetUrlToPath(src))
    .filter(Boolean)
    .map((filePath) => fsp.rm(filePath, { force: true }).catch(() => {}));

  if (deletions.length) {
    await Promise.all(deletions);
  }
}

async function writeJsonAtomic(filePath, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath = path.join(dir, `.${base}.${suffix}.tmp`);
  let mode = 0o666;

  try {
    mode = (await fsp.stat(filePath)).mode & 0o777;
  } catch {
    // Use the process umask for first-time writes.
  }

  try {
    await fsp.writeFile(tempPath, body, { encoding: "utf8", flag: "wx", mode });
    const fileHandle = await fsp.open(tempPath, "r");
    try {
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }
    await fsp.rename(tempPath, filePath);
    try {
      const dirHandle = await fsp.open(dir, "r");
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    } catch (error) {
      debugLog("directory fsync skipped", error.message);
    }
  } catch (error) {
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

let presentationWriteQueue = Promise.resolve();

function queuePresentationWrite(value) {
  const writeTask = presentationWriteQueue.then(() => writeJsonAtomic(configPath, value));
  presentationWriteQueue = writeTask.catch(() => {});
  return writeTask;
}

function firstHeading(markdown, fallback) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      return heading[1].replace(/[*_`]/g, "").trim();
    }

    return trimmed.replace(/[*_`]/g, "").trim();
  }

  return fallback;
}

function normalizeSlideConfig(slide, index) {
  const normalized = slide && typeof slide === "object" ? { ...slide } : {};
  normalized.type = index === 0 ? "cover" : (normalized.type || "text");
  normalized.layout = normalized.layout || (normalized.type === "terminalText" ? "hero" : "center");
  normalized.mustReadUrl = normalizeMustReadUrl(normalized.mustReadUrl);

  if (normalized.type === "cover") {
    normalized.layout = "cover";
    normalized.terminal = { enabled: false };
  } else if (normalized.type === "terminalText" || normalized.type === "terminalFocused") {
    normalized.layout = normalized.type === "terminalText" ? "hero" : "center";
    normalized.terminal = {
      ...(normalized.terminal || {}),
      enabled: true,
      ...terminalTemplateGeometry[normalized.type]
    };
    if (normalized.type === "terminalText") {
      normalized.terminal.position = normalized.terminal.position === "left" ? "left" : "right";
    }
  } else if (!normalized.terminal) {
    normalized.terminal = { enabled: false };
  }

  const legacyScale = Number.isFinite(Number(normalized.textScale)) ? Number(normalized.textScale) : null;
  if (Number.isFinite(Number(normalized.headingScale))) {
    normalized.headingScale = Number(normalized.headingScale);
  } else if (legacyScale !== null) {
    normalized.headingScale = legacyScale;
  }

  if (Number.isFinite(Number(normalized.bodyScale))) {
    normalized.bodyScale = Number(normalized.bodyScale);
  } else if (legacyScale !== null) {
    normalized.bodyScale = legacyScale;
  }

  if (normalized.headingScale === undefined && normalized.bodyScale !== undefined) {
    normalized.headingScale = normalized.bodyScale;
  }

  if (normalized.bodyScale === undefined && normalized.headingScale !== undefined) {
    normalized.bodyScale = normalized.headingScale;
  }

  if (normalized.headingScale !== undefined || normalized.bodyScale !== undefined) {
    normalized.textScale = normalized.bodyScale ?? normalized.headingScale;
  }

  return normalized;
}

function normalizeMustReadUrl(url) {
  const value = String(url ?? "").trim();
  if (!value) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) {
    return value;
  }

  return `https://${value}`;
}

function normalizeContactUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  if (trimmed.includes("@") && !trimmed.includes(" ")) {
    return `mailto:${trimmed}`;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function normalizeProfileUrl(value, platform) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  if (platform === "github" && trimmed.startsWith("@")) {
    return `https://github.com/${trimmed.slice(1).replace(/^\/+/, "")}`;
  }

  if (platform === "linkedin" && trimmed.startsWith("@")) {
    return `https://www.linkedin.com/in/${trimmed.slice(1).replace(/^\/+/, "")}`;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function displayMustReadUrl(url) {
  const value = normalizeMustReadUrl(url);
  if (!value) {
    return "";
  }

  if (value.length <= 72) {
    return value;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.host;
    const pathname = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    if (pathname) {
      const segments = pathname.split("/").filter(Boolean);
      const head = segments.slice(0, 2).join("/");
      const prefix = head ? `${head}/...` : "...";
      return `${parsed.protocol}//${host}/${prefix}`;
    }
    return `${parsed.protocol}//${host}/...`;
  } catch {
    const trimmed = value.slice(0, 68).replace(/\/+$/, "");
    return `${trimmed}/...`;
  }
}

function normalizeDefaults(defaults) {
  const normalized = defaults && typeof defaults === "object" ? { ...defaults } : {};
  const legacyScale = Number.isFinite(Number(normalized.textScale)) ? Number(normalized.textScale) : 1;
  const headingScale = Number.isFinite(Number(normalized.headingScale)) ? Number(normalized.headingScale) : legacyScale;
  const bodyScale = Number.isFinite(Number(normalized.bodyScale)) ? Number(normalized.bodyScale) : legacyScale;
  normalized.headingScale = headingScale;
  normalized.bodyScale = bodyScale;
  normalized.textScale = Number.isFinite(Number(normalized.textScale)) ? Number(normalized.textScale) : bodyScale;
  return normalized;
}

function normalizeSlideMarkdown(slide) {
  const value = String(slide ?? "").replace(/\r\n/g, "\n");
  return value.trim() ? value : "";
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw validationError(`${label} must be an object.`);
  }
}

function assertAllowedKeys(value, allowedKeys, label) {
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    throw validationError(`${label} contains unsupported key(s): ${unexpected.join(", ")}.`);
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && typeof value !== "string") {
    throw validationError(`${label} must be a string.`);
  }
}

function assertOptionalBoolean(value, label) {
  if (value !== undefined && typeof value !== "boolean") {
    throw validationError(`${label} must be a boolean.`);
  }
}

function assertOptionalNumber(value, label, min, max) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${label} must be a finite number.`);
  }

  if (value < min || value > max) {
    throw validationError(`${label} must be between ${min} and ${max}.`);
  }
}

function assertOptionalOneOf(value, allowedValues, label) {
  if (value !== undefined && !allowedValues.has(value)) {
    throw validationError(`${label} has an unsupported value.`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value)) {
    throw validationError(`${label} must be an array.`);
  }

  value.forEach((item, index) => {
    if (typeof item !== "string") {
      throw validationError(`${label}[${index}] must be a string.`);
    }
  });
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateTheme(theme, label, allowedKeys) {
  if (theme === undefined) {
    return;
  }

  assertPlainObject(theme, label);
  assertAllowedKeys(theme, allowedKeys, label);
  Object.keys(theme).forEach((key) => {
    assertOptionalString(theme[key], `${label}.${key}`);
  });
}

function validateDefaultTerminal(terminal, label) {
  if (terminal === undefined) {
    return;
  }

  assertPlainObject(terminal, label);
  assertAllowedKeys(terminal, allowedDefaultTerminalKeys, label);
  assertOptionalString(terminal.shell, `${label}.shell`);
  assertOptionalString(terminal.cwd, `${label}.cwd`);
  assertOptionalNumber(terminal.fontSize, `${label}.fontSize`, 8, 48);
  validateTheme(terminal.theme, `${label}.theme`, allowedTerminalThemeKeys);
}

function validateDefaults(defaults, label) {
  if (defaults === undefined) {
    return;
  }

  assertPlainObject(defaults, label);
  assertAllowedKeys(defaults, allowedDefaultsKeys, label);
  assertOptionalNumber(defaults.textScale, `${label}.textScale`, 0.6, 1.8);
  assertOptionalNumber(defaults.headingScale, `${label}.headingScale`, 0.6, 1.8);
  assertOptionalNumber(defaults.bodyScale, `${label}.bodyScale`, 0.6, 1.8);
  validateDefaultTerminal(defaults.terminal, `${label}.terminal`);
}

function validateCover(cover, label) {
  if (cover === undefined) {
    return;
  }

  assertPlainObject(cover, label);
  assertAllowedKeys(cover, allowedCoverKeys, label);
  assertOptionalString(cover.kicker, `${label}.kicker`);
  assertOptionalString(cover.subtitle, `${label}.subtitle`);
  assertOptionalString(cover.title, `${label}.title`);
  assertOptionalString(cover.agendaTitle, `${label}.agendaTitle`);
  if (cover.agenda !== undefined) {
    assertStringArray(cover.agenda, `${label}.agenda`);
  }
}

function validateStringObject(value, label, allowedKeys) {
  if (value === undefined) {
    return;
  }

  assertPlainObject(value, label);
  assertAllowedKeys(value, allowedKeys, label);
  Object.keys(value).forEach((key) => {
    assertOptionalString(value[key], `${label}.${key}`);
  });
}

function validateTerminalConfig(terminal, label, type, index) {
  if (terminal === undefined) {
    if (type === "terminalText" || type === "terminalFocused") {
      throw validationError(`${label} is required for terminal slides.`);
    }
    return;
  }

  assertPlainObject(terminal, label);
  assertAllowedKeys(terminal, allowedTerminalKeys, label);
  assertOptionalBoolean(terminal.enabled, `${label}.enabled`);
  assertOptionalNumber(terminal.leftVw, `${label}.leftVw`, 0, 100);
  assertOptionalNumber(terminal.topVh, `${label}.topVh`, 0, 100);
  assertOptionalNumber(terminal.widthVw, `${label}.widthVw`, 1, 100);
  assertOptionalNumber(terminal.heightVh, `${label}.heightVh`, 1, 100);
  assertOptionalString(terminal.position, `${label}.position`);
  assertOptionalString(terminal.title, `${label}.title`);
  assertOptionalString(terminal.shell, `${label}.shell`);
  assertOptionalString(terminal.cwd, `${label}.cwd`);
  assertOptionalNumber(terminal.fontSize, `${label}.fontSize`, 8, 48);
  validateTheme(terminal.theme, `${label}.theme`, allowedTerminalThemeKeys);

  if (terminal.position !== undefined && terminal.position !== "left" && terminal.position !== "right") {
    throw validationError(`${label}.position must be "left" or "right".`);
  }

  if (index === 0 && terminal.enabled !== false) {
    throw validationError("slides[0].terminal.enabled must be false.");
  }

  if ((type === "terminalText" || type === "terminalFocused") && terminal.enabled !== true) {
    throw validationError(`${label}.enabled must be true for terminal slides.`);
  }

  if (type !== "terminalText" && type !== "terminalFocused" && terminal.enabled === true) {
    throw validationError(`${label}.enabled is only allowed for terminal slide types.`);
  }
}

function validateImageConfig(image, label, type) {
  if (image === undefined) {
    if (type === "image") {
      throw validationError(`${label} is required for image slides.`);
    }
    return;
  }

  if (type !== "image") {
    throw validationError(`${label} is only allowed on image slides.`);
  }

  assertPlainObject(image, label);
  assertAllowedKeys(image, allowedImageKeys, label);
  assertOptionalString(image.src, `${label}.src`);
  assertOptionalString(image.alt, `${label}.alt`);
  assertOptionalNumber(image.x, `${label}.x`, -100, 100);
  assertOptionalNumber(image.y, `${label}.y`, -100, 100);
  assertOptionalNumber(image.scale, `${label}.scale`, 0.2, 3);
}

function validateSlideConfig(slide, index) {
  assertPlainObject(slide, `slides[${index}]`);
  assertAllowedKeys(slide, allowedSlideKeys, `slides[${index}]`);

  if (typeof slide.type !== "string" || !allowedTemplateTypes.has(slide.type)) {
    throw validationError(`slides[${index}].type must be one of: ${Array.from(allowedTemplateTypes).join(", ")}.`);
  }

  if (index === 0 && slide.type !== "cover") {
    throw validationError("slides[0].type must be cover.");
  }

  if (index > 0 && slide.type === "cover") {
    throw validationError(`slides[${index}].type cannot be cover.`);
  }

  assertOptionalOneOf(slide.layout, allowedLayouts, `slides[${index}].layout`);
  assertOptionalString(slide.mustReadUrl, `slides[${index}].mustReadUrl`);
  assertOptionalNumber(slide.headingScale, `slides[${index}].headingScale`, 0.6, 1.8);
  assertOptionalNumber(slide.bodyScale, `slides[${index}].bodyScale`, 0.6, 1.8);
  assertOptionalNumber(slide.textScale, `slides[${index}].textScale`, 0.6, 1.8);
  validateTerminalConfig(slide.terminal, `slides[${index}].terminal`, slide.type, index);
  validateImageConfig(slide.image, `slides[${index}].image`, slide.type);
}

function validatePresentationPayload(payload) {
  assertPlainObject(payload, "payload");
  assertAllowedKeys(payload, allowedPayloadKeys, "payload");

  const inputConfig = payload.config;
  assertPlainObject(inputConfig, "payload.config");
  assertAllowedKeys(inputConfig, allowedConfigKeys, "payload.config");

  if (payload.contentSlides !== undefined) {
    assertStringArray(payload.contentSlides, "payload.contentSlides");
  }
  if (inputConfig.contentSlides !== undefined) {
    assertStringArray(inputConfig.contentSlides, "payload.config.contentSlides");
  }

  const contentSlides = payload.contentSlides !== undefined ? payload.contentSlides : inputConfig.contentSlides;
  if (!Array.isArray(contentSlides)) {
    throw validationError("payload.contentSlides is required.");
  }

  if (payload.contentSlides !== undefined && inputConfig.contentSlides !== undefined && !sameStringArray(payload.contentSlides, inputConfig.contentSlides)) {
    throw validationError("payload.contentSlides and payload.config.contentSlides must match by index.");
  }

  if (contentSlides.length < minSlides || contentSlides.length > maxSlides) {
    throw validationError(`Presentations must contain ${minSlides}-${maxSlides} slides.`);
  }

  if (!Array.isArray(inputConfig.slides)) {
    throw validationError("payload.config.slides must be an array.");
  }

  if (inputConfig.slides.length !== contentSlides.length) {
    throw validationError("payload.config.slides and payload.contentSlides must have identical lengths.");
  }

  assertOptionalString(inputConfig.title, "payload.config.title");
  validateTheme(inputConfig.theme, "payload.config.theme", allowedThemeKeys);
  validateDefaults(inputConfig.defaults, "payload.config.defaults");
  validateCover(inputConfig.cover, "payload.config.cover");
  validateStringObject(inputConfig.metadata, "payload.config.metadata", allowedMetadataKeys);
  validateStringObject(inputConfig.presenter, "payload.config.presenter", allowedPresenterKeys);
  inputConfig.slides.forEach(validateSlideConfig);

  return {
    config: {
      ...inputConfig,
      contentSlides
    },
    contentSlides
  };
}

function normalizePresentation(config) {
  const rawContentSlides = Array.isArray(config.contentSlides) ? config.contentSlides : [""];
  const normalizedSlides = rawContentSlides.slice(0, maxSlides).map(normalizeSlideMarkdown);
  const rawConfigSlides = Array.isArray(config.slides) ? config.slides : [];
  const configSlides = normalizedSlides.map((_, index) => normalizeSlideConfig(rawConfigSlides[index], index));
  const defaults = normalizeDefaults(config.defaults);

  return {
    config: {
      ...config,
      defaults,
      slides: configSlides,
      contentSlides: normalizedSlides
    },
    contentSlides: normalizedSlides
  };
}

function agendaItems(contentSlides, config) {
  const coverAgenda = config.cover?.agenda;
  if (Array.isArray(coverAgenda) && coverAgenda.length) {
    return coverAgenda.slice(0, 8).map(String);
  }

  return contentSlides
    .slice(1)
    .map((slide, index) => firstHeading(slide, `Slide ${index + 2}`))
    .filter(Boolean)
    .slice(0, 8);
}

function terminalStyle(terminal) {
  const leftVw = Number.isFinite(Number(terminal.leftVw)) ? Number(terminal.leftVw) : 52;
  const topVh = Number.isFinite(Number(terminal.topVh)) ? Number(terminal.topVh) : 12;
  const widthVw = Number.isFinite(Number(terminal.widthVw)) ? Number(terminal.widthVw) : 42;
  const heightVh = Number.isFinite(Number(terminal.heightVh)) ? Number(terminal.heightVh) : 72;
  return `left:${leftVw}vw;top:${topVh}vh;width:${widthVw}vw;height:${heightVh}vh;`;
}

function imageStyle(image) {
  const x = Number.isFinite(Number(image?.x)) ? Number(image.x) : 0;
  const y = Number.isFinite(Number(image?.y)) ? Number(image.y) : 0;
  const scale = Number.isFinite(Number(image?.scale)) ? Number(image.scale) : 1;
  return `transform:translate(${x}%, ${y}%) scale(${scale});`;
}

function slideTypographyStyle(slideConfig, defaults) {
  const hasExplicitScale = Number.isFinite(Number(slideConfig?.headingScale))
    || Number.isFinite(Number(slideConfig?.bodyScale))
    || Number.isFinite(Number(slideConfig?.textScale));
  if (!hasExplicitScale) {
    return "";
  }

  const fallbackHeading = Number(defaults?.headingScale || defaults?.textScale || 1);
  const fallbackBody = Number(defaults?.bodyScale || defaults?.textScale || 1);
  const legacyScale = Number.isFinite(Number(slideConfig?.textScale)) ? Number(slideConfig.textScale) : null;
  const headingScale = Number.isFinite(Number(slideConfig?.headingScale))
    ? Number(slideConfig.headingScale)
    : legacyScale ?? fallbackHeading;
  const bodyScale = Number.isFinite(Number(slideConfig?.bodyScale))
    ? Number(slideConfig.bodyScale)
    : legacyScale ?? fallbackBody;
  return `style="--heading-scale:${headingScale};--body-scale:${bodyScale};"`;
}

function shellLaunchSpec(shell) {
  const shellName = path.basename(shell).toLowerCase();

  if (shellName.includes("zsh")) {
    return { file: shell, args: ["-i"] };
  }

  if (shellName.includes("bash")) {
    return { file: shell, args: ["-i"] };
  }

  return { file: shell, args: [] };
}

function renderCoverSlide(config, contentSlides, index, slideConfig) {
  const cover = config.cover || {};
  const meta = config.metadata || {};
  const presenter = config.presenter || {};
  const items = agendaItems(contentSlides, config);
  const coverTitle = escapeHtml(cover.title || config.title || "Untitled");
  const coverSubtitle = escapeHtml(cover.subtitle || cover.kicker || "Presentation");
  const contactHref = normalizeContactUrl(presenter.contact);
  const websiteHref = normalizeMustReadUrl(presenter.website);
  const githubHref = normalizeProfileUrl(presenter.github, "github");
  const linkedinHref = normalizeProfileUrl(presenter.linkedin, "linkedin");
  const field = (label, value, href, iconName) => {
    const display = value ? escapeHtml(value) : "&nbsp;";
    const labelIconMarkup = iconName
      ? `<img class="cover-link-icon cover-link-icon-light" src="${iconName === "github" ? "/GitHub_Invertocat_Black.png" : "/InBug-Black.png"}" alt="" /><img class="cover-link-icon cover-link-icon-dark" src="${iconName === "github" ? "/GitHub_Invertocat_White.png" : "/InBug-White.png"}" alt="" />`
      : "";
    const labelMarkup = `${labelIconMarkup}<span>${escapeHtml(label)}</span>`;
    const valueMarkup = `<span>${display}</span>`;
    const renderedValue = href && value
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${valueMarkup}</a>`
      : `<span class="cover-value-inline">${valueMarkup}</span>`;
    return `<li class="cover-meta-item"><span class="cover-label">${labelMarkup}</span><div class="cover-value">${renderedValue}</div></li>`;
  };
  const agendaMarkup = items.length
    ? `<ol>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>`
    : "";
  const mustReadMarkup = renderMustReadMarkup(slideConfig, "cover");

  return `<section class="slide layout-cover slide-type-cover active" data-slide-index="${index}" data-slide-type="cover" aria-hidden="false" ${slideTypographyStyle(slideConfig, config.defaults)}>
    <div class="cover-stage">
      <div class="cover-copy">
        <div class="cover-copy-inner">
          <h1>${coverTitle}</h1>
          <p class="cover-kicker">${coverSubtitle}</p>
        </div>
      </div>
      <div class="cover-meta" aria-label="Presenter details">
        <ul class="cover-meta-list">
          ${field("Name", presenter.name || "", "", "")}
          ${field("Role", presenter.role || "", "", "")}
          ${field("Mail / Contact", presenter.contact || "", contactHref, "")}
          ${field("Website", presenter.website || "", websiteHref, "")}
          ${field("GitHub", presenter.github || "", githubHref, "github")}
          ${field("LinkedIn", presenter.linkedin || "", linkedinHref, "linkedin")}
          ${field("Date", meta.date || "", "", "")}
          ${field("Version", meta.version || "", "", "")}
        </ul>
      </div>
      <div class="cover-agenda">
        <h2>${escapeHtml(cover.agendaTitle || "Agenda")}</h2>
        ${agendaMarkup}
      </div>
    </div>
    ${mustReadMarkup}
  </section>`;
}

function renderImageMarkup(slideConfig, index) {
  const image = slideConfig.image || {};
  if (!image.src) {
    return `<div class="image-stage empty" id="image-stage-${index}"></div>`;
  }

  return `<div class="image-stage" id="image-stage-${index}">
    <div class="image-frame" style="${imageStyle(image)}">
      <img data-src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt || "")}" />
    </div>
  </div>`;
}

function renderMustReadMarkup(slideConfig, slideType) {
  const url = String(slideConfig?.mustReadUrl ?? "").trim();
  if (!url) {
    return "";
  }

  const className = slideType === "cover" ? "must-read-footer must-read-cover" : "must-read-footer";
  const display = escapeHtml(displayMustReadUrl(url));
  return `<footer class="${className}">
    <span>must read: ${display}</span>
  </footer>`;
}

function renderSlides(contentSlides, config) {
  const configSlides = config.slides || [];
  return contentSlides
    .map((slideMarkdown, index) => {
      const slideConfig = configSlides[index] || {};
      if (index === 0 || slideConfig.type === "cover") {
        return renderCoverSlide(config, contentSlides, index, slideConfig);
      }

      const type = slideConfig.type || "text";
      const layout = slideConfig.layout === "hero" ? "layout-hero" : "layout-center";
      const terminal = slideConfig.terminal && slideConfig.terminal.enabled ? slideConfig.terminal : null;
      const terminalTitle = terminal?.title || `Terminal ${index + 1}`;
      const terminalPosition = terminal?.position === "left" ? "terminal-left" : "terminal-right";
      const slideHtml = type === "terminalFocused" ? "" : renderMarkdown(slideMarkdown);
      const terminalMarkup = terminal
        ? `<div class="terminal-card" id="terminal-card-${index}" tabindex="${index === 0 ? "0" : "-1"}" aria-label="${escapeHtml(terminalTitle)}" aria-hidden="${index === 0 ? "false" : "true"}" style="${terminalStyle(terminal)}">
            <div class="terminal-bar">
              <div class="terminal-left">
                <div class="terminal-leds" aria-hidden="true"><span></span><span></span><span></span></div>
                <div class="terminal-title">${escapeHtml(terminalTitle)}</div>
              </div>
              <div class="terminal-status" id="terminal-status-${index}">Idle</div>
            </div>
            <div class="terminal-stage" id="terminal-stage-${index}"></div>
          </div>`
        : "";
      const imageMarkup = type === "image" ? renderImageMarkup(slideConfig, index) : "";
      const copyMarkup = type === "terminalFocused" ? "" : `<div class="slide-copy">${slideHtml}</div>`;
      const mustReadMarkup = renderMustReadMarkup(slideConfig, type);

      return `<section class="slide ${layout} slide-type-${escapeHtml(type)}${terminal ? " has-terminal" : ""} ${terminal ? terminalPosition : ""}" data-slide-index="${index}" data-slide-type="${escapeHtml(type)}" aria-hidden="true" ${slideTypographyStyle(slideConfig, config.defaults)}>
        ${copyMarkup}
        ${imageMarkup}
        ${terminalMarkup}
        ${mustReadMarkup}
      </section>`;
    })
    .join("\n");
}

function rawPathIsUnsafe(rawPath) {
  if (rawPath.includes("\0") || /%00/i.test(rawPath)) {
    return true;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return true;
  }

  if (decodedPath.includes("\0")) {
    return true;
  }

  return decodedPath.split(/[\\/]+/).some((segment) => segment === "..");
}

function decodeUrlPath(urlPath) {
  try {
    const decodedPath = decodeURIComponent(urlPath);
    return decodedPath.includes("\0") ? null : decodedPath;
  } catch {
    return null;
  }
}

function confinedPath(baseDir, relativeUrlPath) {
  const relativePath = relativeUrlPath.replace(/^\/+/, "");
  const normalizedPath = path.normalize(relativePath);
  if (!normalizedPath || normalizedPath === "." || normalizedPath.includes("\0") || path.isAbsolute(normalizedPath)) {
    return null;
  }

  if (normalizedPath.split(path.sep).includes("..")) {
    return null;
  }

  const filePath = path.join(baseDir, normalizedPath);
  const relative = path.relative(baseDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return filePath;
}

function assetPathForUrl(urlPath) {
  const decodedPath = decodeUrlPath(urlPath);
  if (!decodedPath) {
    return null;
  }

  if (decodedPath === "/client.js") {
    return clientPath;
  }

  if (decodedPath.startsWith("/node_modules/")) {
    const relativePath = decodedPath.slice("/node_modules/".length);
    const localPath = confinedPath(localNodeModulesDir, relativePath);
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }

    const parentPath = confinedPath(parentNodeModulesDir, relativePath);
    if (parentPath && fs.existsSync(parentPath)) {
      return parentPath;
    }

    return localPath;
  }

  return confinedPath(rootDir, decodedPath);
}

function serveFile(res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": stat.size,
      "cache-control": "no-cache"
    });
    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      debugLog("static stream failed", error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      }
      res.end("Failed to read file");
    });
    stream.pipe(res);
  });
}

function readRequestJson(req) {
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return Promise.reject(httpError(413, "Request body is too large."));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;

    function settle(error, value) {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    }

    req.on("data", (chunk) => {
      if (settled) {
        return;
      }

      receivedBytes += chunk.length;
      if (receivedBytes > maxRequestBytes) {
        req.pause();
        settle(httpError(413, "Request body is too large."));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) {
        return;
      }

      try {
        const body = Buffer.concat(chunks, receivedBytes).toString("utf8");
        settle(null, JSON.parse(body || "{}"));
      } catch (error) {
        const parseError = httpError(400, "Invalid JSON.");
        parseError.detail = error.message;
        settle(parseError);
      }
    });

    req.on("error", (error) => {
      settle(error);
    });
  });
}

function sendJson(res, statusCode, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-cache"
  });
  res.end(body);
}

async function handlePresentationApi(req, res) {
  try {
    if (req.method === "GET") {
      const config = readJson(configPath);
      const normalized = normalizePresentation(config);
      sendJson(res, 200, normalized);
      return;
    }

    if (req.method !== "PUT") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
  } catch (error) {
    debugLog("api read failed", error);
    sendJson(res, 500, { error: "Failed to read presentation files.", detail: debugEnabled ? error.message : undefined });
    return;
  }

  try {
    const payload = await readRequestJson(req);
    const validated = validatePresentationPayload(payload);
    const normalized = normalizePresentation(validated.config);
    const previousConfig = readJson(configPath);
    const materialized = await materializeImageAssets(normalized.config);
    const nextConfig = materialized.config;
    await queuePresentationWrite(nextConfig);
    await deleteUnusedContentAssets(previousConfig, nextConfig);
    const nextNormalized = normalizePresentation(nextConfig);
    debugLog("saved presentation", `${nextNormalized.contentSlides.length} slides`);
    sendJson(res, 200, nextNormalized);
  } catch (error) {
    if (res.writableEnded) {
      return;
    }

    debugLog("api request failed", error);
    const statusCode = error.statusCode || 500;
    if (statusCode === 413) {
      res.once("finish", () => {
        req.destroy();
      });
      sendJson(res, 413, { error: "Save payload is too large.", detail: debugEnabled ? error.message : undefined });
      return;
    }
    if (statusCode === 400) {
      sendJson(res, 400, { error: error.message || "Invalid presentation payload.", detail: debugEnabled ? (error.detail || error.stack) : undefined });
      return;
    }
    sendJson(res, 500, { error: "Failed to write presentation files.", detail: debugEnabled ? error.message : undefined });
  }
}

function handleHealthApi(res) {
  try {
    const config = readJson(configPath);
    const normalized = normalizePresentation(config);
    sendJson(res, 200, {
      ok: true,
      cwd: rootDir,
      title: config.title || "Presentation",
      slides: normalized.contentSlides.length,
      maxSlides,
      debug: debugEnabled,
      api: ["/api/presentation", "/api/health"]
    });
  } catch (error) {
    debugLog("health failed", error);
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleAudioApi(res) {
  const audioDir = path.join(contentDir, "audio");
  let entries;
  try {
    entries = await fsp.readdir(audioDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson(res, 200, { tracks: [] });
      return;
    }
    throw error;
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  const tracks = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => allowedAudioExtensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => collator.compare(a, b))
    .map((name) => ({
      name,
      url: `/content/audio/${encodeURIComponent(name)}`
    }));

  sendJson(res, 200, { tracks });
}

function buildDeckHtml() {
  const template = readText(templatePath);
  const config = readJson(configPath);
  const normalized = normalizePresentation(config);
  const renderedSlides = renderSlides(normalized.contentSlides, normalized.config);
  const theme = config.theme || {};
  const defaults = normalized.config.defaults || {};
  const html = template
    .replaceAll("{{TITLE}}", escapeHtml(normalized.config.title || "Presentation"))
    .replaceAll("{{BG}}", JSON.stringify(theme.background || "#000000"))
    .replaceAll("{{FG}}", JSON.stringify(theme.foreground || "#f2f2f2"))
    .replaceAll("{{MUTED}}", JSON.stringify(theme.muted || "#8a8a8a"))
    .replaceAll("{{ACCENT}}", JSON.stringify(theme.accent || "#7dff9b"))
    .replaceAll("{{HEADING_SCALE}}", String(Number(defaults.headingScale || defaults.textScale || 1)))
    .replaceAll("{{BODY_SCALE}}", String(Number(defaults.bodyScale || defaults.textScale || 1)))
    .replaceAll("{{SLIDES}}", renderedSlides)
    .replaceAll("{{CONFIG_JSON}}", JSON.stringify({
      title: normalized.config.title || "Presentation",
      theme,
      defaults,
      cover: normalized.config.cover || {},
      metadata: normalized.config.metadata || {},
      presenter: normalized.config.presenter || {},
      slides: normalized.config.slides || [],
      contentSlides: normalized.contentSlides,
      constraints: {
        minSlides: 1,
        maxSlides
      }
    }));

  return html;
}

const server = http.createServer((req, res) => {
  const rawPath = (req.url || "/").split("?")[0] || "/";
  if (rawPathIsUnsafe(rawPath)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const { pathname } = requestUrl;

  if (pathname === "/" || pathname === "/index.html") {
    try {
      const html = buildDeckHtml();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(html);
    } catch (error) {
      debugLog("render failed", error);
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Failed to render presentation");
    }
    return;
  }

  if (pathname === "/api/presentation") {
    handlePresentationApi(req, res).catch((error) => {
      debugLog("api failed", error);
      if (!res.writableEnded) {
        sendJson(res, 500, { error: "Presentation API failed.", detail: debugEnabled ? error.message : undefined });
      }
    });
    return;
  }

  if (pathname === "/api/health") {
    handleHealthApi(res);
    return;
  }

  if (pathname === "/api/audio") {
    handleAudioApi(res).catch((error) => {
      debugLog("audio api failed", error);
      if (!res.writableEnded) {
        sendJson(res, 500, { error: "Audio API failed.", detail: debugEnabled ? error.message : undefined });
      }
    });
    return;
  }

  const assetPath = assetPathForUrl(pathname);
  if (!assetPath) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  serveFile(res, assetPath);
});

const wss = new WebSocket.Server({ noServer: true });
const activeTerminalSessions = new Set();
let shuttingDown = false;

function websocketIsOpen(ws) {
  return ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING;
}

function closeSocket(ws, code, reason) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(code, reason);
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    }
  } catch {
    // Ignore socket teardown failures.
  }
}

function teardownTerminalSession(session, options = {}) {
  if (!session || session.closed) {
    return;
  }

  session.closed = true;
  activeTerminalSessions.delete(session);

  if (options.closeSocket && websocketIsOpen(session.ws)) {
    closeSocket(session.ws, options.code || 1001, options.reason || "Terminal session closed");
  }

  if (options.killPty !== false && session.term) {
    try {
      session.term.kill();
    } catch {
      // Ignore kill errors on already-exited PTYs.
    }
  }
}

function loadTerminalConfig(slideIndex) {
  const normalized = normalizePresentation(readJson(configPath)).config;
  const slide = normalized.slides?.[slideIndex];
  if (!slide || !slide.terminal?.enabled) {
    return null;
  }

  return {
    defaults: normalized.defaults || {},
    slide,
    terminal: slide.terminal || {}
  };
}

function resolveTerminalCwd(terminal, terminalDefaults) {
  const configuredCwd = terminal.cwd || terminalDefaults.cwd || rootDir;
  const cwd = path.resolve(rootDir, configuredCwd);

  try {
    if (fs.statSync(cwd).isDirectory()) {
      return cwd;
    }
  } catch {
    debugLog("terminal cwd unavailable, falling back to root", cwd);
  }

  return rootDir;
}

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      debugLog("terminating stale websocket");
      ws.terminate();
      return;
    }

    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  });
}, websocketHeartbeatMs);

heartbeatInterval.unref();

server.on("upgrade", (req, socket, head) => {
  const rawPath = (req.url || "/").split("?")[0] || "/";
  if (rawPathIsUnsafe(rawPath)) {
    socket.destroy();
    return;
  }

  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  if (requestUrl.pathname !== "/terminal") {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, requestUrl);
  });
});

wss.on("connection", (ws, requestUrl) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const slideIndex = Number.parseInt(requestUrl.searchParams.get("slide") || "0", 10);
  if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= maxSlides) {
    ws.close(1008, "Invalid slide");
    return;
  }

  let terminalConfig;
  try {
    terminalConfig = loadTerminalConfig(slideIndex);
  } catch (error) {
    debugLog("terminal config failed", error);
    ws.close(1011, "Failed to load terminal config");
    return;
  }

  if (!terminalConfig) {
    ws.close(1008, "Slide has no terminal");
    return;
  }

  const defaults = terminalConfig.defaults;
  const terminal = terminalConfig.terminal;
  const terminalDefaults = defaults.terminal || {};
  const shell =
    terminal.shell && terminal.shell !== "auto"
      ? terminal.shell
      : process.platform === "win32"
        ? (process.env.COMSPEC || "powershell.exe")
        : (process.env.SHELL || "/bin/bash");
  const shellSpec = shellLaunchSpec(shell);
  const cwd = resolveTerminalCwd(terminal, terminalDefaults);
  const shellHome = process.env.HOME || (process.platform === "win32" ? undefined : "/root");
  const shellEnv = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor"
  };

  if (shellHome) {
    shellEnv.HOME = shellHome;
    shellEnv.ZDOTDIR = shellHome;
  }

  let term;
  let session;
  try {
    term = pty.spawn(shellSpec.file, shellSpec.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 36,
      cwd,
      env: shellEnv
    });
  } catch (error) {
    ws.send(JSON.stringify({ type: "status", text: `Failed to start shell: ${error.message}` }));
    ws.close();
    return;
  }

  session = { ws, term, closed: false };
  activeTerminalSessions.add(session);
  ws.send(JSON.stringify({ type: "ready" }));

  term.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "data", data }));
    }
  });

  term.onExit(() => {
    if (!session.closed && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "Terminal exited");
    }
    teardownTerminalSession(session, { killPty: false });
  });

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === "input" && typeof message.data === "string") {
      term.write(message.data);
    } else if (message.type === "resize") {
      const cols = Number.parseInt(message.cols, 10);
      const rows = Number.parseInt(message.rows, 10);
      if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
        try {
          term.resize(cols, rows);
        } catch {
          // Ignore transient resize failures.
        }
      }
    }
  });

  ws.on("close", () => {
    teardownTerminalSession(session, { killPty: true });
  });

  ws.on("error", () => {
    teardownTerminalSession(session, { killPty: true });
  });
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  debugLog("shutdown requested", signal);
  clearInterval(heartbeatInterval);

  for (const session of Array.from(activeTerminalSessions)) {
    teardownTerminalSession(session, {
      closeSocket: true,
      killPty: true,
      code: 1001,
      reason: "Server shutting down"
    });
  }

  for (const ws of wss.clients) {
    try {
      ws.terminate();
    } catch {
      // Ignore termination failures.
    }
  }

  wss.close();
  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, shutdownGraceMs).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("exit", () => {
  clearInterval(heartbeatInterval);
  for (const session of Array.from(activeTerminalSessions)) {
    teardownTerminalSession(session, { killPty: true });
  }
});

function listen(port) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`Presentation tool running at http://127.0.0.1:${port}/`);
  });
}

const preferredPort = Number.parseInt(process.env.PORT || "8080", 10);
let activePort = Number.isFinite(preferredPort) ? preferredPort : 8080;

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    activePort += 1;
    listen(activePort);
    return;
  }

  throw error;
});

listen(activePort);
