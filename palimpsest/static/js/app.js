const appState = JSON.parse(document.getElementById("app-state").textContent);

let grammarFiles = [];
let grammarFileMap = new Map();
let activeGrammarAdapter = "plain";
let sourceWorkspace = null;
let grammarWorkspace = null;

const highlighters = new Map();

function registerHighlighter(adapter) {
  highlighters.set(adapter.id, adapter);
}

registerHighlighter({
  id: "plain",
  label: "Plain text",
  highlightGrammar: highlightPlain,
  highlightSource: highlightPlain,
});

registerHighlighter({
  id: "pest",
  label: "Pest",
  highlightGrammar: highlightPest,
  highlightSource: highlightSourceLike,
});

registerHighlighter({
  id: "tree-sitter",
  label: "Tree-sitter",
  highlightGrammar: highlightJavaScriptLike,
  highlightSource: highlightSourceLike,
});

registerHighlighter({
  id: "lezer",
  label: "Lezer",
  highlightGrammar: highlightLezer,
  highlightSource: highlightSourceLike,
});

class CodeEditor {
  constructor({ textarea, highlight, title, status, getHighlighter, onInput }) {
    this.textarea = textarea;
    this.highlight = highlight;
    this.title = title;
    this.status = status;
    this.getHighlighter = getHighlighter;
    this.onInput = onInput;
    this.file = null;
    this.pendingRender = false;

    this.textarea.addEventListener("input", () => {
      this.queueRender();
      this.onInput?.(this);
    });
    this.textarea.addEventListener("scroll", () => this.syncScroll());
  }

  setFile(file, content) {
    this.file = file;
    this.textarea.value = content;
    this.title.textContent = `${file.path} (${file.size} B)`;
    this.setStatus("");
    this.render();
  }

  clear(message) {
    this.file = null;
    this.textarea.value = "";
    this.highlight.textContent = "";
    this.title.textContent = message;
    this.setStatus("");
  }

  queueRender() {
    if (this.pendingRender) {
      return;
    }
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.render();
    });
  }

  render() {
    const highlighter = this.getHighlighter() || highlighters.get("plain").highlightSource;
    this.highlight.innerHTML = `${highlighter(this.textarea.value)}\n`;
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
      getHighlighter: () => this.currentHighlighter(),
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

  async openDirectory(path) {
    return this.browser.open(path);
  }

  async openFile(path) {
    const fileMeta = this.fileMeta(path);
    this.editor.clear(path);
    this.browser.markActive();

    const file = await fetchFile(path, this.editor);
    if (!file) {
      return false;
    }

    const adapter = fileMeta.adapter || detectAdapter(file.path);
    this.editor.setFile({ ...file, adapter }, file.content);
    this.browser.markActive();
    this.afterOpenFile(adapter);
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
  }

  currentHighlighter() {
    const adapterId = this.syntaxRole === "grammar" ? this.editor.file?.adapter : activeGrammarAdapter;
    const adapter = highlighters.get(adapterId) || highlighters.get("plain");
    return this.syntaxRole === "grammar" ? adapter.highlightGrammar : adapter.highlightSource;
  }

  fileMeta(path) {
    return grammarFileMap.get(path) || {};
  }

  afterOpenFile(adapter) {
    if (this.syntaxRole !== "grammar") {
      return;
    }

    activeGrammarAdapter = adapter || "plain";
    this.editor.setStatus(`${adapterLabel(activeGrammarAdapter)} adapter active.`);
    sourceWorkspace?.editor.queueRender();
  }

  handleInput() {
    if (this.syntaxRole !== "grammar") {
      return;
    }

    this.editor.setStatus("Grammar changed in memory.");
    sourceWorkspace?.editor.queueRender();
  }
}

customElements.define("palimpsest-editor-workspace", EditorWorkspace);

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

function detectAdapter(path) {
  const name = path.split("/").pop() || "";
  if (name === "grammar.js" || name === "grammar.json" || path.endsWith(".scm")) {
    return "tree-sitter";
  }
  if (path.endsWith(".pest")) {
    return "pest";
  }
  if (path.endsWith(".grammar")) {
    return "lezer";
  }
  return "plain";
}

function fileKindLabel(entry) {
  if (entry.kind === "directory") {
    return "DIR";
  }
  return (entry.suffix || "FILE").replace(".", "").toUpperCase();
}

function adapterLabel(adapterId) {
  return highlighters.get(adapterId)?.label || adapterId;
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

function highlightPest(source) {
  return tokenize(source, {
    lineComment: "//",
    strings: new Set(['"', "'"]),
    ruleAssignment: true,
    keywords: new Set(["SOI", "EOI", "WHITESPACE", "COMMENT", "ANY"]),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "~", "!", "@", "_", "$", "^"]),
  });
}

function highlightLezer(source) {
  return tokenize(source, {
    lineComment: "@comment",
    strings: new Set(['"', "'"]),
    ruleAssignment: true,
    keywords: new Set(["@top", "@tokens", "@skip", "@detectDelim", "@precedence", "@external"]),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", "."]),
  });
}

function highlightJavaScriptLike(source) {
  return tokenize(source, {
    lineComment: "//",
    strings: new Set(['"', "'", "`"]),
    ruleAssignment: false,
    keywords: new Set(["module", "exports", "grammar", "seq", "choice", "repeat", "optional", "token", "prec"]),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", ".", ":", ";"]),
  });
}

function highlightSourceLike(source) {
  return tokenize(source, {
    lineComment: "//",
    strings: new Set(['"', "'"]),
    ruleAssignment: false,
    keywords: new Set(["if", "else", "let", "in", "true", "false", "nil", "and", "or"]),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", ".", ":", ";", "-", "<", ">"]),
  });
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

    if (grammar.lineComment?.startsWith("@") && source.startsWith(grammar.lineComment, index)) {
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
