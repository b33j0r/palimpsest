import { loadWasmParserRuntime } from "./highlight/wasm_runtime.mjs";
import { loadLezerParserRuntime } from "./highlight/lezer_runtime.mjs";

export function registerConfiguredParserRuntimes({ appState, runtimes }) {
  for (const parser of parserRuntimeConfigs(appState)) {
    runtimes.register({
      id: runtimeIdForParser(parser.id),
      version: 0,
      parserId: parser.id,
      label: `${parser.id} parser runtime`,
      ready: false,
    });
  }
}

export async function hydrateConfiguredParserRuntimes({ appState, graph, runtimes }) {
  const loaded = await Promise.allSettled(
    parserRuntimeConfigs(appState).map((parser) =>
      loadConfiguredParserRuntime({ appState, graph, parserId: parser.id, runtimes }),
    ),
  );

  return loaded
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

export async function loadConfiguredParserRuntime({ appState, graph, parserId, runtimes, grammarPath = "" }) {
  const runtimeId = runtimeIdForParser(parserId);
  const parser = parserConfig(appState, parserId);
  if (!parser) {
    graph.emit("parser:runtime-load-failed", {
      parserId,
      runtimeId,
      error: new Error(`Parser config not found: ${parserId}`),
    });
    return null;
  }

  let runtime;
  try {
    runtime = await loadParserRuntime({
      parser,
      captureMap: captureMapForParser(appState, parserId),
    });
  } catch (error) {
    graph.emit("parser:runtime-load-failed", { parserId, runtimeId, error });
    return null;
  }

  return runtimes.update(runtimeId, {
    parserId,
    grammarPath,
    label: `${parserId} parser runtime`,
    highlight: runtime.highlight,
    captureMap: runtime.captureMap,
    parse: runtime.parse,
    ready: true,
  });
}

export function runtimeIdForParser(parserId) {
  return `parser:${parserId}`;
}

export function parserConfig(appState, parserId) {
  return (appState.parsers || []).find((candidate) => candidate.id === parserId) || null;
}

export function captureMapForParser(appState, parserId) {
  const parser = parserConfig(appState, parserId);
  const filetypes = (appState.filetypes || []).filter((filetype) =>
    filetype.parser === parserId || (!filetype.parser && filetype.id === parserId),
  );

  return Object.assign(
    {},
    parser?.highlight_captures || {},
    ...filetypes.map((filetype) => filetype.highlight_captures || {}),
  );
}

function parserRuntimeConfigs(appState) {
  return (appState.parsers || []).filter((parser) => parser.runtime?.module);
}

function loadParserRuntime({ parser, captureMap }) {
  if (parser.adapter === "lezer") {
    return loadLezerParserRuntime({ parser, captureMap });
  }
  return loadWasmParserRuntime({ parser, captureMap });
}
