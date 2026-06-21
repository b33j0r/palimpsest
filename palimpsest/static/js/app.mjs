import { loadGrammarMetadata, loadHealth } from "./api.mjs";
import { findConfiguredFiletype } from "./configured_filetypes.mjs";
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
  renderHealth(await loadHealth());
  grammarFiles = await loadGrammarMetadata();
  grammarFileMap = new Map(grammarFiles.map((file) => [file.path, file]));
  hydrateConfiguredParserRuntimes({ appState, graph, runtimes });

  const leftWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="left"]');
  const rightWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="right"]');

  const leftStartPath = leftWorkspace.dataset.startPath || ".";
  await Promise.all([
    leftWorkspace.openDirectory(leftStartPath),
    openFirstDirectory(rightWorkspace, grammarBrowserStartCandidates()),
  ]);

  await openFirstExampleFile(leftWorkspace, leftStartPath);

  if (grammarFiles[0]) {
    await rightWorkspace.openFile(grammarFiles[0].path);
  } else {
    rightWorkspace.editor.clear(rightWorkspace.emptyTitle);
  }
}

function renderHealth(health) {
  const panel = document.querySelector("[data-health-panel]");
  const summary = document.querySelector("[data-health-summary]");
  const body = document.querySelector("[data-health-body]");
  if (!panel || !summary || !body) {
    return;
  }

  const missingDependencies = (health.dependencies || []).filter((dependency) => !dependency.ok);
  const missingParsers = (health.parsers || []).filter((parser) => !parser.ok);
  panel.dataset.ok = health.ok ? "true" : "false";
  summary.textContent = health.ok
    ? "Project ready"
    : `${missingDependencies.length + missingParsers.length || 1} project readiness issue(s)`;

  body.replaceChildren();
  body.append(
    healthLine("Config", health.config_path || appState.config_path),
    healthLine("Workspace", health.cwd || appState.cwd),
    healthList("Dependencies", health.dependencies || [], (item) =>
      `${item.ok ? "OK" : "Missing"}: ${item.name}${item.path ? ` (${item.path})` : ""}`,
    ),
    healthList("Parsers", health.parsers || [], (parser) =>
      `${parser.ok ? "OK" : "Needs attention"}: ${parser.id}`,
    ),
  );
}

function healthLine(label, value) {
  const line = document.createElement("p");
  line.textContent = `${label}: ${value || "unknown"}`;
  return line;
}

function healthList(label, items, renderItem) {
  const wrapper = document.createElement("div");
  const title = document.createElement("p");
  const list = document.createElement("ul");

  title.textContent = label;
  list.className = "health-list";
  if (!items.length) {
    const empty = document.createElement("li");
    empty.textContent = "No checks";
    list.append(empty);
  } else {
    for (const item of items) {
      const row = document.createElement("li");
      row.textContent = renderItem(item);
      list.append(row);
    }
  }

  wrapper.append(title, list);
  return wrapper;
}

async function openFirstDirectory(workspace, paths) {
  for (const path of paths) {
    if (await workspace.openDirectory(path)) {
      return true;
    }
  }
  return false;
}

async function openFirstExampleFile(workspace, startPath) {
  const path = await firstExampleFilePath(startPath);
  if (path) {
    await workspace.openFile(path);
  }
}

async function firstExampleFilePath(startPath) {
  const candidate = await firstExampleFileCandidate(startPath);
  return candidate?.path || null;
}

async function firstExampleFileCandidate(startPath) {
  const listing = await loadDirectory(startPath);
  if (!listing) {
    return null;
  }

  const files = listing.entries.filter((entry) => entry.kind === "file");
  const configuredFile = files.find((entry) => findConfiguredFiletype(entry, configuredFiletypes));
  if (configuredFile) {
    return { path: configuredFile.path, configured: true };
  }

  let fallback = files[0] ? { path: files[0].path, configured: false } : null;
  for (const directory of listing.entries.filter((entry) => entry.kind === "directory")) {
    const nestedCandidate = await firstExampleFileCandidate(directory.path);
    if (nestedCandidate?.configured) {
      return nestedCandidate;
    }
    fallback = fallback || nestedCandidate;
  }
  return fallback;
}

async function loadDirectory(path) {
  const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    return null;
  }
  return response.json();
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
