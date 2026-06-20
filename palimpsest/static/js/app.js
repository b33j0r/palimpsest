const appState = JSON.parse(document.getElementById("app-state").textContent);

const elements = {
  currentPath: document.getElementById("current-path"),
  fileList: document.getElementById("file-list"),
  parentButton: document.getElementById("parent-button"),
  grammarList: document.getElementById("grammar-list"),
  saveGrammarButton: document.getElementById("save-grammar-button"),
  saveExampleButton: document.getElementById("save-example-button"),
  grammarTitle: document.getElementById("grammar-title"),
  exampleTitle: document.getElementById("example-title"),
  grammarStatus: document.getElementById("grammar-status"),
  exampleStatus: document.getElementById("example-status"),
};

let browserPath = appState.examples_dir;
let examplesBrowserRoot = null;
let grammarFiles = [];
let activeGrammar = null;

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
  constructor({ textareaId, highlightId, title, status, getAdapter }) {
    this.textarea = document.getElementById(textareaId);
    this.highlight = document.getElementById(highlightId);
    this.title = title;
    this.status = status;
    this.getAdapter = getAdapter;
    this.file = null;
    this.pendingRender = false;

    this.textarea.addEventListener("input", () => this.queueRender());
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
    const highlighter = this.getAdapter() || highlighters.get("plain").highlightSource;
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

const grammarEditor = new CodeEditor({
  textareaId: "grammar-editor",
  highlightId: "grammar-highlight",
  title: elements.grammarTitle,
  status: elements.grammarStatus,
  getAdapter: () => (highlighters.get(activeGrammar?.adapter) || highlighters.get("plain")).highlightGrammar,
});

const exampleEditor = new CodeEditor({
  textareaId: "example-editor",
  highlightId: "example-highlight",
  title: elements.exampleTitle,
  status: elements.exampleStatus,
  getAdapter: () => (highlighters.get(activeGrammar?.adapter) || highlighters.get("plain")).highlightSource,
});

grammarEditor.textarea.addEventListener("input", () => {
  exampleEditor.queueRender();
  grammarEditor.setStatus("Grammar changed in memory.");
});

function parentPath(path) {
  const cleanPath = path === "." ? "" : path.replace(/\/+$/, "");
  if (!cleanPath || cleanPath === ".") {
    return null;
  }
  const parts = cleanPath.split("/");
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

async function loadDirectory(path) {
  browserPath = path;
  elements.currentPath.textContent = "Loading...";
  elements.fileList.replaceChildren();

  const response = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    elements.currentPath.textContent = "Unable to load directory";
    return;
  }

  const listing = await response.json();
  browserPath = listing.path;
  examplesBrowserRoot = examplesBrowserRoot || listing.path;
  elements.currentPath.textContent = listing.path;
  updateParentButton(listing.path);
  renderEntries(listing.entries);
}

function updateParentButton(path) {
  const canGoParent = parentPath(path) !== null;
  const canCollapseToExamples = examplesBrowserRoot && path !== examplesBrowserRoot;
  elements.parentButton.disabled = !canGoParent && !canCollapseToExamples;
  elements.parentButton.textContent = canGoParent ? "^" : "v";
  elements.parentButton.title = canGoParent ? "Parent directory" : "Collapse to examples";
  elements.parentButton.setAttribute("aria-label", elements.parentButton.title);
}

function renderEntries(entries) {
  elements.fileList.replaceChildren();

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No files";
    elements.fileList.append(empty);
    return;
  }

  for (const entry of entries) {
    renderEntry(entry, elements.fileList, 0);
  }
}

function renderEntry(entry, container, depth) {
  const row = document.createElement("button");
  row.className = "file-row";
  row.type = "button";
  row.dataset.kind = entry.kind;
  row.dataset.path = entry.path;
  row.style.setProperty("--depth", depth);

  if (entry.kind === "directory") {
    row.setAttribute("aria-expanded", "false");
    row.addEventListener("click", () => toggleDirectory(row, entry, depth));
  } else {
    row.addEventListener("click", () => loadExampleFile(entry.path));
  }

  const kind = document.createElement("span");
  kind.className = "file-kind";
  kind.textContent = fileKindLabel(entry, false);

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = entry.name;

  const size = document.createElement("span");
  size.className = "file-size";
  size.textContent = entry.size === null ? "" : `${entry.size} B`;

  row.append(kind, name, size);
  container.append(row);
}

async function toggleDirectory(row, entry, depth) {
  const expanded = row.getAttribute("aria-expanded") === "true";
  const existingChildren = row.nextElementSibling;

  if (expanded) {
    row.setAttribute("aria-expanded", "false");
    row.querySelector(".file-kind").textContent = fileKindLabel(entry, false);
    if (existingChildren?.classList.contains("file-children")) {
      existingChildren.remove();
    }
    return;
  }

  row.setAttribute("aria-expanded", "true");
  row.querySelector(".file-kind").textContent = fileKindLabel(entry, true);

  if (existingChildren?.classList.contains("file-children")) {
    return;
  }

  const childContainer = document.createElement("div");
  childContainer.className = "file-children";
  childContainer.textContent = "Loading...";
  row.after(childContainer);

  const response = await fetch(`/api/files?path=${encodeURIComponent(entry.path)}`);
  if (!response.ok) {
    childContainer.textContent = "Unable to load directory";
    return;
  }

  const listing = await response.json();
  childContainer.replaceChildren();
  if (!listing.entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-list";
    empty.textContent = "No files";
    childContainer.append(empty);
    return;
  }

  for (const childEntry of listing.entries) {
    renderEntry(childEntry, childContainer, depth + 1);
  }
}

function fileKindLabel(entry, expanded) {
  if (entry.kind === "directory") {
    return expanded ? "-DIR" : "+DIR";
  }
  return (entry.suffix || "FILE").replace(".", "").toUpperCase();
}

async function loadGrammarList() {
  elements.grammarList.replaceChildren();
  grammarEditor.clear("Loading grammar files...");

  const response = await fetch("/api/grammars");
  if (!response.ok) {
    grammarEditor.clear("Unable to load grammar files");
    return;
  }

  grammarFiles = await response.json();
  if (!grammarFiles.length) {
    grammarEditor.clear("No grammar files configured");
    renderEmptyGrammarList();
    return;
  }

  renderGrammarEntries();
  await loadGrammarFile(grammarFiles[0].path);
}

function renderEmptyGrammarList() {
  elements.grammarList.replaceChildren();
  const empty = document.createElement("p");
  empty.className = "empty-list";
  empty.textContent = "No grammar files";
  elements.grammarList.append(empty);
}

function renderGrammarEntries() {
  elements.grammarList.replaceChildren();

  for (const file of grammarFiles) {
    const row = document.createElement("button");
    row.className = "file-row";
    row.type = "button";
    row.dataset.kind = "file";
    row.dataset.path = file.path;
    row.addEventListener("click", () => loadGrammarFile(file.path));

    const kind = document.createElement("span");
    kind.className = "file-kind";
    kind.textContent = file.adapter.toUpperCase();

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;

    const size = document.createElement("span");
    size.className = "file-size";
    size.textContent = `${file.size} B`;

    row.append(kind, name, size);
    elements.grammarList.append(row);
  }
}

async function loadGrammarFile(path) {
  activeGrammar = grammarFiles.find((file) => file.path === path) || null;
  markActiveGrammar(path);
  grammarEditor.clear(path);

  const file = await fetchFile(path, grammarEditor);
  if (!file) {
    return;
  }

  activeGrammar = activeGrammar || {
    path: file.path,
    adapter: "plain",
  };
  grammarEditor.setFile({ ...file, adapter: activeGrammar.adapter }, file.content);
  grammarEditor.setStatus(`${adapterLabel(activeGrammar.adapter)} adapter active.`);
  exampleEditor.queueRender();
}

function markActiveGrammar(path) {
  for (const row of elements.grammarList.querySelectorAll(".file-row")) {
    if (row.dataset.path === path) {
      row.setAttribute("aria-current", "true");
    } else {
      row.removeAttribute("aria-current");
    }
  }
}

async function loadExampleFile(path) {
  exampleEditor.clear(path);
  const file = await fetchFile(path, exampleEditor);
  if (file) {
    exampleEditor.setFile(file, file.content);
  }
}

async function fetchFile(path, editor) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    editor.setStatus("Unable to load file.");
    return null;
  }
  return response.json();
}

async function saveEditor(editor) {
  if (!editor.file) {
    editor.setStatus("No file selected.");
    return;
  }

  editor.setStatus("Saving...");
  const response = await fetch("/api/file", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      path: editor.file.path,
      content: editor.textarea.value,
    }),
  });

  if (!response.ok) {
    editor.setStatus("Save failed.");
    return;
  }

  const file = await response.json();
  editor.file = file;
  editor.title.textContent = `${file.path} (${file.size} B)`;
  editor.setStatus("Saved.");
}

function adapterLabel(adapterId) {
  return highlighters.get(adapterId)?.label || adapterId;
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

elements.parentButton.addEventListener("click", () => {
  const nextPath = parentPath(browserPath);
  if (nextPath !== null) {
    loadDirectory(nextPath);
    return;
  }
  if (examplesBrowserRoot && browserPath !== examplesBrowserRoot) {
    loadDirectory(examplesBrowserRoot);
  }
});

elements.saveGrammarButton.addEventListener("click", () => saveEditor(grammarEditor));
elements.saveExampleButton.addEventListener("click", () => saveEditor(exampleEditor));

loadDirectory(browserPath);
loadGrammarList();
