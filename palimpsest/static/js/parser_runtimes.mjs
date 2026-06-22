import { loadWasmParserRuntime } from "./highlight/wasm_runtime.mjs";
import { loadLezerParserRuntime } from "./highlight/lezer_runtime.mjs";
import { loadTreeSitterParserRuntime } from "./highlight/tree_sitter_runtime.mjs";

export class ParserRuntimeLoaderRegistry {
  constructor({ defaultLoader = null } = {}) {
    this.loaders = new Map();
    this.loaderOrder = [];
    this.defaultLoader = defaultLoader;
    if (defaultLoader?.id) {
      this.loaders.set(defaultLoader.id, defaultLoader);
    }
  }

  register(loader) {
    this.loaders.set(loader.id, loader);
    this.loaderOrder = this.loaderOrder.filter((existing) => existing.id !== loader.id);
    this.loaderOrder.push(loader);
    return loader;
  }

  get(id) {
    return this.loaders.get(id) || null;
  }

  async load({ parser, captureMap }) {
    const loader = this.loaderOrder.find((candidate) => candidate.match?.(parser)) || this.defaultLoader;
    if (!loader?.load) {
      throw new Error(`No parser runtime loader registered for adapter ${parser?.adapter || "unknown"}.`);
    }
    return loader.load({ parser, captureMap });
  }
}

export function createDefaultParserRuntimeLoaderRegistry() {
  const registry = new ParserRuntimeLoaderRegistry({
    defaultLoader: {
      id: "wasm",
      match: () => true,
      load: loadWasmParserRuntime,
    },
  });

  registry.register({
    id: "lezer",
    match: (parser) => parser.adapter === "lezer",
    load: loadLezerParserRuntime,
  });
  registry.register({
    id: "tree-sitter",
    match: (parser) => parser.adapter === "tree-sitter",
    load: loadTreeSitterParserRuntime,
  });
  registry.register({
    id: "pest",
    match: (parser) => parser.adapter === "pest",
    load: loadWasmParserRuntime,
  });
  registry.register({
    id: "nom",
    match: (parser) => parser.adapter === "nom",
    load: loadWasmParserRuntime,
  });

  return registry;
}

export const PARSER_RUNTIME_LOADERS = createDefaultParserRuntimeLoaderRegistry();

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

export async function loadConfiguredParserRuntime({
  appState,
  graph,
  parserId,
  runtimes,
  grammarPath = "",
  loaderRegistry = PARSER_RUNTIME_LOADERS,
}) {
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
    runtime = await loaderRegistry.load({
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
