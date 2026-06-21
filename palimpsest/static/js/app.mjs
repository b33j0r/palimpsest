import { loadGrammarMetadata } from "./api.mjs";
import { SignalGraph } from "./core/signal_graph.mjs";
import { CompilerRegistry, FallbackHighlighterRegistry, ModeRegistry, RuntimeRegistry } from "./core/registries.mjs";
import { normalizeConfiguredFiletypes, registerConfiguredFiletypeHighlighters } from "./configured_filetypes.mjs";
import { highlightPlain } from "./highlight/tokenizer.mjs";
import { registerFallbackHighlighters } from "./highlight/fallbacks.mjs";
import { registerModes } from "./modes/index.mjs";
import { hydrateConfiguredParserRuntimes, registerConfiguredParserRuntimes } from "./parser_runtimes.mjs";
import { parentPath } from "./utils/path.mjs";
import { createEditorWorkspaceClass } from "./workspace.mjs";

const appState = JSON.parse(document.getElementById("app-state").textContent);
const configuredFiletypes = normalizeConfiguredFiletypes(appState);

let grammarFiles = [];
let grammarFileMap = new Map();

const graph = new SignalGraph();
const runtimes = new RuntimeRegistry({ graph });
const compilers = new CompilerRegistry();
const fallbackHighlighters = new FallbackHighlighterRegistry();
const modeRegistry = new ModeRegistry({ graph });

graph.set("openedFormats", new Map());
graph.on("editor:file-opened", ({ detail }) => {
  const openedFormats = new Map(graph.get("openedFormats") || []);
  const formatId = detail.format?.id || detail.mode.id;
  const format = openedFormats.get(formatId) || {
    formatId,
    modeId: detail.mode.id,
    label: detail.format?.label || detail.mode.label,
    paths: new Set(),
  };
  const paths = new Set(format.paths);
  paths.add(detail.file.path);
  openedFormats.set(formatId, { ...format, modeId: detail.mode.id, paths });
  graph.set("openedFormats", openedFormats);
});

registerConfiguredParserRuntimes({ appState, runtimes });

registerFallbackHighlighters(fallbackHighlighters);
registerConfiguredFiletypeHighlighters(fallbackHighlighters, configuredFiletypes, highlightPlain);
registerModes({
  modeRegistry,
  fallbackHighlighters,
  runtimes,
  compilers,
  graph,
  configuredFiletypes,
});

customElements.define(
  "palimpsest-editor-workspace",
  createEditorWorkspaceClass({
    appState,
    compilers,
    fallbackHighlighters,
    graph,
    modeRegistry,
    runtimes,
    getGrammarFileMeta: (path) => grammarFileMap.get(path) || {},
  }),
);

initializeWorkspaces();

async function initializeWorkspaces() {
  grammarFiles = await loadGrammarMetadata();
  grammarFileMap = new Map(grammarFiles.map((file) => [file.path, file]));
  hydrateConfiguredParserRuntimes({ appState, graph, runtimes });

  const leftWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="left"]');
  const rightWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="right"]');

  await Promise.all([
    leftWorkspace.openDirectory(leftWorkspace.dataset.startPath || "."),
    openFirstDirectory(rightWorkspace, grammarBrowserStartCandidates()),
  ]);

  if (grammarFiles[0]) {
    await rightWorkspace.openFile(grammarFiles[0].path);
  } else {
    rightWorkspace.editor.clear(rightWorkspace.emptyTitle);
  }
}

async function openFirstDirectory(workspace, paths) {
  for (const path of paths) {
    if (await workspace.openDirectory(path)) {
      return true;
    }
  }
  return false;
}

function grammarBrowserStartCandidates() {
  const startPath = grammarBrowserStartPath();
  const candidates = [startPath];
  const parent = parentPath(startPath);

  if (parent !== null) {
    candidates.push(parent);
  }
  candidates.push(".");

  return [...new Set(candidates)];
}

function grammarBrowserStartPath() {
  if (grammarFiles.length) {
    return parentPath(grammarFiles[0].path) || ".";
  }
  if (appState.grammar_files.length) {
    return appState.grammar_files[0];
  }
  return ".";
}
