import { parserRuntimeModuleUrl } from "../api.mjs";

export async function loadWasmParserRuntime({ parser, captureMap }) {
  if (!parser?.runtime?.module) {
    throw new Error(`Parser ${parser?.id || ""} does not declare a runtime module.`);
  }

  const module = await import(parserRuntimeModuleUrl(parser.id, parser.runtime.module));
  const init = module.default;

  if (typeof init === "function") {
    await init();
  }

  const parseExport = parser.runtime.parse_export || "parse_to_json";
  const parse = module[parseExport];
  if (typeof parse !== "function") {
    throw new Error(`Runtime module does not export ${parseExport}.`);
  }

  return {
    id: `parser:${parser.id}`,
    parserId: parser.id,
    parse,
    captureMap: captureMap || {},
    highlight: (source) => highlightWithRuntime(source, parse, captureMap || {}),
  };
}

export function highlightWithRuntime(source, parse, captureMap = {}) {
  let parsed;
  try {
    parsed = JSON.parse(parse(source));
  } catch (error) {
    return escapeHtml(source);
  }

  if (!parsed?.ok || !Array.isArray(parsed.tokens)) {
    return escapeHtml(source);
  }

  return highlightTokenSpans(source, parsed.tokens, captureMap);
}

export function highlightTokenSpans(source, tokens, captureMap) {
  let html = "";
  let cursor = 0;
  const spans = tokens
    .map((token) => normalizedToken(token, captureMap))
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || right.end - left.end);

  for (const span of spans) {
    if (span.start < cursor || span.end <= span.start || span.start > source.length) {
      continue;
    }

    const end = Math.min(span.end, source.length);
    html += escapeHtml(source.slice(cursor, span.start));
    html += `<span class="tok-${span.className}">${escapeHtml(source.slice(span.start, end))}</span>`;
    cursor = end;
  }

  html += escapeHtml(source.slice(cursor));
  return html;
}

function normalizedToken(token, captureMap) {
  const capture = token.capture || token.rule;
  const className = tokenClass(captureMap[capture] || capture);
  const start = Number.isInteger(token.start_utf16) ? token.start_utf16 : token.start;
  const end = Number.isInteger(token.end_utf16) ? token.end_utf16 : token.end;

  if (!capture || !className || !Number.isInteger(start) || !Number.isInteger(end)) {
    return null;
  }

  return { start, end, className };
}

function tokenClass(capture) {
  return String(capture || "")
    .trim()
    .replaceAll(".", "-")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
