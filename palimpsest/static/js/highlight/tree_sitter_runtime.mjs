import { parserRuntimeAssetUrl, parserRuntimeModuleUrl } from "../api.mjs";
import { escapeHtml, highlightTokenSpans } from "./wasm_runtime.mjs";

export async function loadTreeSitterParserRuntime({ parser, captureMap }) {
  if (!parser?.runtime?.module) {
    throw new Error(`Parser ${parser?.id || ""} does not declare a runtime module.`);
  }

  const module = await import(parserRuntimeModuleUrl(parser.id, parser.runtime.module));
  const exportName = parser.runtime.parse_export || "createTreeSitterRuntime";
  const createRuntime = module[exportName];
  if (typeof createRuntime !== "function") {
    throw new Error(`Runtime module does not export Tree-sitter runtime factory ${exportName}.`);
  }

  const treeSitterParser = await createRuntime({
    wasmUrl: parserRuntimeAssetUrl(parser.id, "parser.wasm"),
    engineWasmUrl: parserRuntimeAssetUrl(parser.id, "web-tree-sitter.wasm"),
  });
  if (!treeSitterParser || typeof treeSitterParser.parse !== "function") {
    throw new Error(`Tree-sitter runtime factory ${exportName} did not return a parser.`);
  }

  return {
    id: `parser:${parser.id}`,
    parserId: parser.id,
    parse: (source) => parseTreeSitterToJson(source, treeSitterParser, captureMap || {}),
    captureMap: captureMap || {},
    highlight: (source) => highlightWithTreeSitter(source, treeSitterParser, captureMap || {}),
    ready: true,
  };
}

export function highlightWithTreeSitter(source, parser, captureMap = {}) {
  let parsed;
  try {
    parsed = parseTreeSitter(source, parser, captureMap);
  } catch (error) {
    return escapeHtml(source);
  }

  if (!parsed.ok) {
    return escapeHtml(source);
  }
  return highlightTokenSpans(source, parsed.tokens, captureMap);
}

export function parseTreeSitterToJson(source, parser, captureMap = {}) {
  try {
    return JSON.stringify(parseTreeSitter(source, parser, captureMap));
  } catch (error) {
    return JSON.stringify({ ok: false, error: String(error?.message || error) });
  }
}

function parseTreeSitter(source, parser, captureMap) {
  const tree = parser.parse(source);
  if (!tree?.rootNode) {
    return { ok: false, error: "Tree-sitter parser returned no syntax tree." };
  }

  const utf16Offsets = byteToUtf16Offsets(source);
  const tokens = [];
  collectTokens(tree.rootNode, captureMap, utf16Offsets, tokens);
  return { ok: true, tokens };
}

function collectTokens(node, captureMap, utf16Offsets, tokens) {
  const capture = node.type;
  if (captureMap[capture]) {
    tokens.push({
      rule: capture,
      capture,
      start: node.startIndex,
      end: node.endIndex,
      start_utf16: utf16Offsets.get(node.startIndex),
      end_utf16: utf16Offsets.get(node.endIndex),
    });
  }

  for (let index = 0; index < node.childCount; index += 1) {
    collectTokens(node.child(index), captureMap, utf16Offsets, tokens);
  }
}

function byteToUtf16Offsets(source) {
  const encoder = new TextEncoder();
  const offsets = new Map([[0, 0]]);
  let byteOffset = 0;

  for (let index = 0; index < source.length;) {
    const codePoint = source.codePointAt(index);
    const char = String.fromCodePoint(codePoint);
    byteOffset += encoder.encode(char).length;
    index += char.length;
    offsets.set(byteOffset, index);
  }

  return offsets;
}
