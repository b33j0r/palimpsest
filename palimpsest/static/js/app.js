const appState = JSON.parse(document.getElementById("app-state").textContent);

let grammarFiles = [];
let grammarFileMap = new Map();
let sourceWorkspace = null;
let grammarWorkspace = null;

class SignalGraph {
  constructor() {
    this.listeners = new Map();
    this.state = new Map();
  }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = { type, detail };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
    for (const listener of this.listeners.get("*") || []) {
      listener(event);
    }
  }

  set(key, value) {
    const previous = this.state.get(key);
    this.state.set(key, value);
    this.emit(`${key}:changed`, { key, value, previous });
  }

  get(key) {
    return this.state.get(key);
  }
}

const graph = new SignalGraph();

class RuntimeRegistry {
  constructor({ graph }) {
    this.graph = graph;
    this.runtimes = new Map();
  }

  register(runtime) {
    this.runtimes.set(runtime.id, runtime);
    this.graph.emit("runtime:registered", { runtime });
    this.graph.emit(`runtime:${runtime.id}:changed`, { runtime });
  }

  update(id, patch) {
    const previous = this.runtimes.get(id) || { id, version: 0 };
    const runtime = {
      ...previous,
      ...patch,
      id,
      version: patch.version ?? previous.version + 1,
    };
    this.runtimes.set(id, runtime);
    this.graph.emit("runtime:changed", { runtime, previous });
    this.graph.emit(`runtime:${id}:changed`, { runtime, previous });
    return runtime;
  }

  get(id) {
    return this.runtimes.get(id);
  }
}

const runtimes = new RuntimeRegistry({ graph });

class CompilerRegistry {
  constructor() {
    this.compilers = new Map();
  }

  register(compiler) {
    this.compilers.set(compiler.id, compiler);
  }

  async compile(id, context) {
    const compiler = this.compilers.get(id);
    if (!compiler) {
      context.workspace.editor.setStatus(`Compiler not registered: ${id}.`);
      return null;
    }
    return compiler.compile(context);
  }
}

const compilers = new CompilerRegistry();

graph.set("openedFormats", new Map());
graph.on("editor:file-opened", ({ detail }) => {
  const openedFormats = new Map(graph.get("openedFormats") || []);
  const modeId = detail.mode.id;
  const format = openedFormats.get(modeId) || {
    modeId,
    label: detail.mode.label,
    paths: new Set(),
  };
  const paths = new Set(format.paths);
  paths.add(detail.file.path);
  openedFormats.set(modeId, { ...format, paths });
  graph.set("openedFormats", openedFormats);
});

runtimes.register({
  id: "project-format",
  version: 0,
  grammarPath: "",
  label: "Project format",
  highlight: highlightSourceLike,
  ready: false,
});

class ModeRegistry {
  constructor({ graph }) {
    this.graph = graph;
    this.modes = new Map();
    this.modeOrder = [];
  }

  register(mode) {
    this.modes.set(mode.id, mode);
    this.modeOrder.push(mode);
  }

  get(id) {
    return this.modes.get(id) || this.modes.get("plain");
  }

  detect(file, workspace) {
    for (const mode of this.modeOrder) {
      if (mode.match?.(file, workspace, this.graph)) {
        return mode;
      }
    }
    return this.get("plain");
  }
}

const modeRegistry = new ModeRegistry({ graph });

function registerModes() {
  modeRegistry.register(createTokenMode({
    id: "pest",
    label: "Pest",
    adapters: ["pest"],
    extensions: [".pest"],
    grammar: {
      lineComment: "//",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["SOI", "EOI", "WHITESPACE", "COMMENT", "ANY"]),
      operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "~", "!", "@", "_", "$", "^"]),
    },
    toolbar: pestToolbar,
    compilerId: "pest-project-format",
  }));

  modeRegistry.register(createTokenMode({
    id: "lezer",
    label: "Lezer",
    adapters: ["lezer"],
    extensions: [".grammar"],
    grammar: {
      lineComment: "@comment",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["@top", "@tokens", "@skip", "@detectDelim", "@precedence", "@external"]),
      operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", "."]),
    },
  }));

  modeRegistry.register(createTokenMode({
    id: "tree-sitter",
    label: "Tree-sitter",
    adapters: ["tree-sitter"],
    filenames: ["grammar.js", "grammar.json"],
    grammar: javascriptGrammar(["grammar", "seq", "choice", "repeat", "optional", "token", "prec"]),
  }));

  modeRegistry.register(createTokenMode({
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    grammar: sourceGrammar({
      lineComment: "//",
      keywords: ["as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
    }),
  }));

  modeRegistry.register(createTokenMode({
    id: "c",
    label: "C",
    extensions: [".c", ".h"],
    grammar: sourceGrammar({
      lineComment: "//",
      keywords: ["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "int", "long", "register", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while"],
    }),
  }));

  modeRegistry.register(createTokenMode({
    id: "python",
    label: "Python",
    extensions: [".py", ".pyi"],
    grammar: sourceGrammar({
      lineComment: "#",
      keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"],
    }),
  }));

  modeRegistry.register(createTokenMode({
    id: "scheme",
    label: "Scheme",
    extensions: [".scm", ".ss", ".sls", ".sps", ".rkt"],
    grammar: sourceGrammar({
      lineComment: ";",
      keywords: ["and", "begin", "cond", "define", "define-syntax", "delay", "do", "else", "if", "lambda", "let", "let*", "letrec", "or", "quasiquote", "quote", "set!", "syntax-rules", "unless", "when"],
    }),
  }));

  modeRegistry.register(createTokenMode({
    id: "ini",
    label: "INI",
    extensions: [".ini", ".cfg", ".conf", ".toml"],
    grammar: {
      lineComment: "#",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["true", "false", "yes", "no", "on", "off"]),
      operators: new Set(["=", ":", "[", "]", ".", ","]),
    },
  }));

  modeRegistry.register(createTokenMode({
    id: "javascript",
    label: "JavaScript",
    extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    grammar: javascriptGrammar(["async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "yield"]),
  }));

  modeRegistry.register(createTokenMode({
    id: "css",
    label: "CSS",
    extensions: [".css"],
    grammar: sourceGrammar({
      lineComment: null,
      keywords: ["@media", "@supports", "@container", "@layer", "@keyframes", "display", "grid", "flex", "block", "none", "absolute", "relative", "fixed", "sticky", "var", "color-mix"],
    }),
  }));

  modeRegistry.register({
    id: "project-format",
    label: "Project format",
    match: (file, workspace, graph) => workspace.syntaxRole === "source" && Boolean(runtimes.get("project-format")?.ready),
    runtimeIds: () => ["project-format"],
    highlight: (source) => runtimes.get("project-format")?.highlight(source) || highlightPlain(source),
    status: () => `${runtimes.get("project-format")?.label || "Project format"} active.`,
  });

  modeRegistry.register({
    id: "plain",
    label: "Plain text",
    match: () => true,
    highlight: highlightPlain,
  });
}

registerModes();

class CodeEditor {
  constructor({ textarea, highlight, title, status, toolbar, onInput }) {
    this.textarea = textarea;
    this.highlight = highlight;
    this.title = title;
    this.status = status;
    this.toolbar = toolbar;
    this.onInput = onInput;
    this.file = null;
    this.mode = modeRegistry.get("plain");
    this.pendingRender = false;

    this.textarea.addEventListener("input", () => {
      this.queueRender();
      this.onInput?.(this);
    });
    this.textarea.addEventListener("scroll", () => this.syncScroll());
  }

  setFile(file, content, mode, context) {
    this.file = file;
    this.mode = mode || modeRegistry.get("plain");
    this.textarea.value = content;
    this.title.textContent = `${file.path} (${file.size} B)`;
    this.setStatus(this.mode.status?.(context) || `${this.mode.label} mode.`);
    this.render(context);
  }

  clear(message) {
    this.file = null;
    this.mode = modeRegistry.get("plain");
    this.textarea.value = "";
    this.highlight.textContent = "";
    this.title.textContent = message;
    this.setStatus("");
    this.clearToolbar();
  }

  setToolbar(renderToolbar, context) {
    this.clearToolbar();
    if (!renderToolbar) {
      return;
    }

    const fragment = renderToolbar(context);
    if (!fragment) {
      return;
    }

    this.toolbar.hidden = false;
    this.toolbar.append(fragment);
  }

  clearToolbar() {
    this.toolbar.replaceChildren();
    this.toolbar.hidden = true;
  }

  queueRender(context) {
    if (this.pendingRender) {
      return;
    }
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.render(context);
    });
  }

  render(context = {}) {
    this.highlight.innerHTML = `${this.mode.highlight(this.textarea.value, context)}\n`;
    this.syncScroll();
  }

  syncScroll() {
    this.highlight.parentElement.scrollTop = this.textarea.scrollTop;
    this.highlight.parentElement.scrollLeft = this.textarea.scrollLeft;
  }

  setStatus(message) {
    this.status.textContent = message;
  }
}

class FileBrowser {
  constructor({ pathElement, listElement, onOpenDirectory, onOpenFile, getActivePath }) {
    this.path = ".";
    this.pathElement = pathElement;
    this.listElement = listElement;
    this.onOpenDirectory = onOpenDirectory;
    this.onOpenFile = onOpenFile;
    this.getActivePath = getActivePath;
  }

  async open(path) {
    this.path = path;
    this.pathElement.textContent = "Loading...";
    this.listElement.replaceChildren();

    const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      this.pathElement.textContent = "Unable to load directory";
      return false;
    }

    const listing = await response.json();
    this.path = listing.path;
    this.pathElement.textContent = listing.path;
    this.render(listing.entries);
    return true;
  }

  render(entries) {
    this.listElement.replaceChildren();
    const parent = parentPath(this.path);

    if (parent !== null) {
      this.renderEntry({
        name: "..",
        path: parent,
        kind: "directory",
        size: null,
        suffix: "",
      });
    }

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "No files";
      this.listElement.append(empty);
      return;
    }

    for (const entry of entries) {
      this.renderEntry(entry);
    }

    this.markActive();
  }

  renderEntry(entry) {
    const row = document.createElement("button");
    row.className = "file-row";
    row.type = "button";
    row.dataset.kind = entry.kind;
    row.dataset.path = entry.path;

    if (entry.kind === "directory") {
      row.addEventListener("click", () => this.onOpenDirectory(entry.path));
    } else {
      row.addEventListener("click", () => this.onOpenFile(entry.path));
    }

    const kind = document.createElement("span");
    kind.className = "file-kind";
    kind.textContent = fileKindLabel(entry);

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = entry.name;

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = entry.size === null ? "" : `${entry.size} B`;

    row.append(kind, name, size);
    this.listElement.append(row);
  }

  markActive() {
    const activePath = this.getActivePath?.();
    for (const row of this.listElement.querySelectorAll(".file-row")) {
      if (activePath && row.dataset.path === activePath) {
        row.setAttribute("aria-current", "true");
      } else {
        row.removeAttribute("aria-current");
      }
    }
  }
}

class EditorWorkspace extends HTMLElement {
  connectedCallback() {
    if (this.browser) {
      return;
    }

    const template = document.getElementById("editor-workspace-template");
    this.append(template.content.cloneNode(true));

    this.syntaxRole = this.dataset.syntaxRole || "source";
    this.emptyTitle = this.dataset.emptyTitle || "No file selected";
    this.unsubscribers = [
      graph.on("runtime:changed", ({ detail }) => this.handleRuntimeChange(detail.runtime.id)),
    ];

    const browserTitle = this.querySelector("[data-browser-title]");
    const editorTitle = this.querySelector("[data-editor-title]");
    const sidebar = this.querySelector(".group-sidebar");
    const editorPane = this.querySelector(".editor-pane");
    const textarea = this.querySelector("[data-editor]");

    browserTitle.id = `${this.dataset.workspace}-browser-title`;
    editorTitle.id = `${this.dataset.workspace}-editor-title`;
    sidebar.dataset.region = this.dataset.workspace;
    sidebar.setAttribute("aria-labelledby", browserTitle.id);
    editorPane.dataset.region = this.dataset.workspace;
    editorPane.setAttribute("aria-labelledby", editorTitle.id);

    this.querySelector("[data-browser-eyebrow]").textContent = this.dataset.browserEyebrow || "";
    browserTitle.textContent = this.dataset.browserTitle || "Files";
    this.querySelector("[data-editor-eyebrow]").textContent = this.dataset.editorEyebrow || "";
    editorTitle.textContent = this.dataset.editorTitle || "Editor";
    this.querySelector("[data-source-title]").textContent = this.emptyTitle;
    textarea.setAttribute("aria-label", this.dataset.editorLabel || "Source");

    this.editor = new CodeEditor({
      textarea,
      highlight: this.querySelector("[data-highlight]"),
      title: this.querySelector("[data-source-title]"),
      status: this.querySelector("[data-status]"),
      toolbar: this.querySelector("[data-mode-toolbar]"),
      onInput: () => this.handleInput(),
    });

    this.browser = new FileBrowser({
      pathElement: this.querySelector("[data-path]"),
      listElement: this.querySelector("[data-file-list]"),
      onOpenDirectory: (path) => this.openDirectory(path),
      onOpenFile: (path) => this.openFile(path),
      getActivePath: () => this.editor.file?.path,
    });

    this.querySelector("[data-save-button]").addEventListener("click", () => this.save());
  }

  disconnectedCallback() {
    for (const unsubscribe of this.unsubscribers || []) {
      unsubscribe();
    }
  }

  context(file = this.editor.file, mode = this.editor.mode) {
    return {
      appState,
      compilers,
      file,
      graph,
      mode,
      runtimes,
      registry: modeRegistry,
      workspace: this,
    };
  }

  async openDirectory(path) {
    return this.browser.open(path);
  }

  async openFile(path) {
    this.editor.clear(path);
    this.browser.markActive();

    const file = await fetchFile(path, this.editor);
    if (!file) {
      return false;
    }

    const enrichedFile = { ...file, ...this.fileMeta(file.path) };
    const mode = modeRegistry.detect(enrichedFile, this);
    const context = this.context(enrichedFile, mode);
    this.editor.setFile(enrichedFile, file.content, mode, context);
    this.editor.setToolbar(mode.toolbar, context);
    this.browser.markActive();
    graph.emit("editor:file-opened", { workspace: this, file: enrichedFile, mode });
    return true;
  }

  async save() {
    if (!this.editor.file) {
      this.editor.setStatus("No file selected.");
      return;
    }

    this.editor.setStatus("Saving...");
    const response = await fetch("/api/file", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: this.editor.file.path,
        content: this.editor.textarea.value,
      }),
    });

    if (!response.ok) {
      this.editor.setStatus("Save failed.");
      return;
    }

    const file = await response.json();
    this.editor.file = { ...this.editor.file, ...file };
    this.editor.title.textContent = `${file.path} (${file.size} B)`;
    this.editor.setStatus("Saved.");
    this.browser.markActive();
    graph.emit("editor:file-saved", {
      workspace: this,
      file: this.editor.file,
      mode: this.editor.mode,
    });
  }

  fileMeta(path) {
    return grammarFileMap.get(path) || {};
  }

  handleInput() {
    graph.emit("editor:changed", {
      workspace: this,
      file: this.editor.file,
      mode: this.editor.mode,
    });

    if (this.editor.mode.id === "pest" && pestSettings.autocompile) {
      compilers.compile(this.editor.mode.compilerId, this.context());
    }
  }

  handleRuntimeChange(runtimeId) {
    if (!this.editor.file) {
      return;
    }

    const currentRuntimeIds = this.editor.mode.runtimeIds?.(this.context()) || [];
    const mode = modeRegistry.detect(this.editor.file, this);
    const modeChanged = mode.id !== this.editor.mode.id;
    const runtimeApplies = currentRuntimeIds.includes(runtimeId) || (mode.runtimeIds?.(this.context()) || []).includes(runtimeId);

    if (!modeChanged && !runtimeApplies) {
      return;
    }

    if (modeChanged) {
      this.editor.mode = mode;
      this.editor.setStatus(mode.status?.(this.context()) || `${mode.label} mode.`);
      this.editor.setToolbar(mode.toolbar, this.context());
    }
    this.editor.queueRender(this.context());
    graph.emit("editor:runtime-applied", {
      workspace: this,
      file: this.editor.file,
      mode: this.editor.mode,
      runtimeId,
      runtime: runtimes.get(runtimeId),
    });
  }
}

customElements.define("palimpsest-editor-workspace", EditorWorkspace);

const pestSettings = {
  autocompile: false,
};

function pestToolbar(context) {
  const fragment = document.createDocumentFragment();

  const compileButton = document.createElement("button");
  compileButton.className = "text-button compact";
  compileButton.type = "button";
  compileButton.textContent = "Compile";
  compileButton.addEventListener("click", () => compilers.compile(context.mode.compilerId, context));

  const label = document.createElement("label");
  label.className = "toolbar-check";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = pestSettings.autocompile;
  checkbox.addEventListener("change", () => {
    pestSettings.autocompile = checkbox.checked;
    graph.emit("pest:autocompile-changed", { enabled: pestSettings.autocompile });
    if (pestSettings.autocompile) {
      compilers.compile(context.mode.compilerId, context);
    }
  });

  const text = document.createElement("span");
  text.textContent = "Autocompile";

  label.append(checkbox, text);
  fragment.append(compileButton, label);
  return fragment;
}

compilers.register({
  id: "pest-project-format",
  label: "Pest project-format compiler",
  compile: (context) => {
    const { file, workspace } = context;
    if (!file || workspace.editor.mode.id !== "pest") {
      return null;
    }

    const runtime = runtimes.update("project-format", {
      grammarPath: file.path,
      label: `${file.name || "Pest"} compiled`,
      highlight: highlightSourceLike,
      ready: true,
    });

    workspace.editor.setStatus(`Compiled ${file.path}.`);
    graph.emit("grammar:compiled", { workspace, file, runtime });
    return runtime;
  },
});

function createTokenMode({ id, label, adapters = [], filenames = [], extensions = [], grammar, toolbar, compilerId }) {
  return {
    id,
    label,
    match: (file) => adapters.includes(file.adapter) || filenames.includes(file.name) || extensions.includes(file.suffix),
    highlight: (source) => tokenize(source, grammar),
    toolbar,
    compilerId,
  };
}

function sourceGrammar({ lineComment = "//", keywords = [] }) {
  return {
    lineComment,
    strings: new Set(['"', "'", "`"]),
    ruleAssignment: false,
    keywords: new Set(keywords),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", ".", ":", ";", "-", "<", ">", "!", "&", "%", "#"]),
  };
}

function javascriptGrammar(extraKeywords = []) {
  return sourceGrammar({
    lineComment: "//",
    keywords: ["module", "exports", ...extraKeywords],
  });
}

function parentPath(path) {
  const cleanPath = path === "." ? "" : path.replace(/\/+$/, "");
  if (!cleanPath || cleanPath === ".") {
    return null;
  }
  const parts = cleanPath.split("/");
  parts.pop();
  return parts.length ? parts.join("/") : ".";
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

async function loadGrammarMetadata() {
  const response = await fetch("/api/grammars");
  if (!response.ok) {
    grammarFiles = [];
    grammarFileMap = new Map();
    return;
  }

  grammarFiles = await response.json();
  grammarFileMap = new Map(grammarFiles.map((file) => [file.path, file]));
}

async function fetchFile(path, editor) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    editor.setStatus("Unable to load file.");
    return null;
  }
  return response.json();
}

function fileKindLabel(entry) {
  if (entry.kind === "directory") {
    return "DIR";
  }
  return (entry.suffix || "FILE").replace(".", "").toUpperCase();
}

async function initializeWorkspaces() {
  await loadGrammarMetadata();

  sourceWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="examples"]');
  grammarWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="grammar"]');

  await Promise.all([
    sourceWorkspace.openDirectory(sourceWorkspace.dataset.startPath || "."),
    openFirstDirectory(grammarWorkspace, grammarBrowserStartCandidates()),
  ]);

  if (grammarFiles[0]) {
    await grammarWorkspace.openFile(grammarFiles[0].path);
  } else {
    grammarWorkspace.editor.clear(grammarWorkspace.emptyTitle);
  }
}

initializeWorkspaces();

async function openFirstDirectory(workspace, paths) {
  for (const path of paths) {
    if (await workspace.openDirectory(path)) {
      return true;
    }
  }
  return false;
}

function highlightPlain(source) {
  return escapeHtml(source);
}

function highlightSourceLike(source) {
  return tokenize(source, sourceGrammar({
    keywords: ["if", "else", "let", "in", "true", "false", "nil", "and", "or"],
  }));
}

function tokenize(source, grammar) {
  let html = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (grammar.lineComment === "//" && char === "/" && next === "/") {
      const end = nextLineIndex(source, index);
      html += token("comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.lineComment && grammar.lineComment !== "//" && source.startsWith(grammar.lineComment, index)) {
      const end = nextLineIndex(source, index);
      html += token("comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.strings.has(char)) {
      const end = stringEndIndex(source, index, char);
      html += token("string", source.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char) || char === "@") {
      const end = identifierEndIndex(source, index);
      const word = source.slice(index, end);
      const className = tokenClassForWord(source, end, word, grammar);
      html += className ? token(className, word) : escapeHtml(word);
      index = end;
      continue;
    }

    if (/\d/.test(char)) {
      const end = numberEndIndex(source, index);
      html += token("number", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.operators.has(char)) {
      html += token("operator", char);
      index += 1;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
}

function tokenClassForWord(source, end, word, grammar) {
  if (grammar.keywords.has(word)) {
    return "keyword";
  }
  if (grammar.ruleAssignment && nextNonSpace(source, end) === "=") {
    return "rule";
  }
  return "";
}

function nextLineIndex(source, start) {
  const end = source.indexOf("\n", start);
  return end === -1 ? source.length : end;
}

function stringEndIndex(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function identifierEndIndex(source, start) {
  let index = start + 1;
  while (index < source.length && /[\w-]/.test(source[index])) {
    index += 1;
  }
  return index;
}

function numberEndIndex(source, start) {
  let index = start + 1;
  while (index < source.length && /[\d._]/.test(source[index])) {
    index += 1;
  }
  return index;
}

function nextNonSpace(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return source[index] || "";
}

function token(className, value) {
  return `<span class="tok-${className}">${escapeHtml(value)}</span>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
