import { escapeHtml, highlightTokenSpans } from "./wasm_runtime.mjs";
import { parserRuntimeModuleUrl } from "../api.mjs";

export async function loadLezerParserRuntime({ parser, captureMap }) {
  if (!parser?.runtime?.module) {
    throw new Error(`Parser ${parser?.id || ""} does not declare a runtime module.`);
  }

  const module = await import(parserRuntimeModuleUrl(parser.id, parser.runtime.module));
  const exportName = parser.runtime.parse_export || "parser";
  const lezerParser = module[exportName];
  if (!lezerParser || typeof lezerParser.parse !== "function") {
    throw new Error(`Runtime module does not export Lezer parser ${exportName}.`);
  }

  return {
    id: `parser:${parser.id}`,
    parserId: parser.id,
    parse: (source) => parseLezerToJson(source, lezerParser, captureMap || {}),
    captureMap: captureMap || {},
    highlight: (source) => highlightWithLezer(source, lezerParser, captureMap || {}),
    ready: true,
  };
}

export function highlightWithLezer(source, parser, captureMap = {}) {
  let parsed;
  try {
    parsed = parseLezer(source, parser, captureMap);
  } catch (error) {
    return escapeHtml(source);
  }

  if (!parsed.ok) {
    return escapeHtml(source);
  }
  return highlightTokenSpans(source, parsed.tokens, captureMap);
}

export function parseLezerToJson(source, parser, captureMap = {}) {
  try {
    return JSON.stringify(parseLezer(source, parser, captureMap));
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error?.message || error) });
  }
}

function parseLezer(source, parser, captureMap) {
  const tree = parser.parse(source);
  const tokens = [];
  const cursor = tree.cursor();

  do {
    const capture = cursor.name;
    if (captureMap[capture]) {
      tokens.push({
        rule: capture,
        capture,
        start: cursor.from,
        end: cursor.to,
        start_utf16: cursor.from,
        end_utf16: cursor.to,
      });
    }
  } while (cursor.next());

  return { ok: true, tokens };
}
