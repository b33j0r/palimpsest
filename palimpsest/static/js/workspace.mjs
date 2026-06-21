import { fetchFile } from "./api.mjs";
import { fileKindLabel, parentPath } from "./utils/path.mjs";

export class CodeEditor {
  constructor({ textarea, highlight, title, status, toolbar, modeRegistry, onInput }) {
    this.textarea = textarea;
    this.highlight = highlight;
    this.title = title;
    this.status = status;
    this.toolbar = toolbar;
    this.modeRegistry = modeRegistry;
    this.onInput = onInput;
    this.file = null;
    this.mode = this.modeRegistry.get("generic");
    this.renderContext = {};
    this.pendingRender = false;

    this.textarea.addEventListener("input", () => {
      this.queueRender();
      this.onInput?.(this);
    });
    this.textarea.addEventListener("scroll", () => this.syncScroll());
  }

  setFile(file, content, mode, context) {
    this.file = file;
    this.mode = mode || this.modeRegistry.get("generic");
    this.renderContext = context || {};
    this.textarea.value = content;
    this.title.textContent = `${file.path} (${file.size} B)`;
    this.setStatus(this.mode.status?.(context) || `${this.mode.label} mode.`);
    this.render(context);
  }

  clear(message) {
    this.file = null;
    this.mode = this.modeRegistry.get("generic");
    this.renderContext = {};
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

  queueRender(context = this.renderContext) {
    if (this.pendingRender) {
      return;
    }
    this.renderContext = context || this.renderContext;
    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.render(context);
    });
  }

  render(context = this.renderContext) {
    this.renderContext = context || this.renderContext;
    this.highlight.innerHTML = `${this.mode.highlight(this.textarea.value, this.renderContext)}\n`;
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

export class FileBrowser {
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

export function createEditorWorkspaceClass(dependencies) {
  const {
    appState,
    compilers,
    fallbackHighlighters,
    graph,
    modeRegistry,
    runtimes,
    getGrammarFileMeta,
  } = dependencies;

  return class EditorWorkspace extends HTMLElement {
    connectedCallback() {
      if (this.browser) {
        return;
      }

      const template = document.getElementById("editor-workspace-template");
      this.append(template.content.cloneNode(true));

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
        modeRegistry,
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

    context(file = this.editor.file, mode = this.editor.mode, format = this.resolveFormat(file, mode)) {
      return {
        appState,
        compilers,
        file,
        format,
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

      const enrichedFile = { ...file, ...getGrammarFileMeta(file.path) };
      const mode = modeRegistry.detect(enrichedFile, this);
      const format = this.resolveFormat(enrichedFile, mode);
      const context = this.context(enrichedFile, mode, format);
      this.editor.setFile(enrichedFile, file.content, mode, context);
      this.editor.setToolbar(mode.toolbar, context);
      this.browser.markActive();
      graph.emit("editor:file-opened", { workspace: this, file: enrichedFile, mode, format });
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

    resolveFormat(file, mode) {
      if (!file) {
        return fallbackHighlighters.get("plain");
      }
      if (mode?.highlighterId) {
        return fallbackHighlighters.get(mode.highlighterId);
      }
      return mode?.format?.(file) || fallbackHighlighters.detect(file);
    }

    handleInput() {
      graph.emit("editor:changed", {
        workspace: this,
        file: this.editor.file,
        mode: this.editor.mode,
      });

      this.editor.mode.onInput?.(this.context());
    }

    handleRuntimeChange(runtimeId) {
      if (!this.editor.file) {
        return;
      }

      const currentRuntimeIds = this.editor.mode.runtimeIds?.(this.context()) || [];
      const mode = modeRegistry.detect(this.editor.file, this);
      const format = this.resolveFormat(this.editor.file, mode);
      const context = this.context(this.editor.file, mode, format);
      const modeChanged = mode.id !== this.editor.mode.id;
      const runtimeApplies = currentRuntimeIds.includes(runtimeId) || (mode.runtimeIds?.(context) || []).includes(runtimeId);

      if (!modeChanged && !runtimeApplies) {
        return;
      }

      if (modeChanged) {
        this.editor.mode = mode;
        this.editor.renderContext = context;
        this.editor.setStatus(mode.status?.(context) || `${mode.label} mode.`);
        this.editor.setToolbar(mode.toolbar, context);
      }
      this.editor.queueRender(context);
      graph.emit("editor:runtime-applied", {
        workspace: this,
        file: this.editor.file,
        mode: this.editor.mode,
        runtimeId,
        runtime: runtimes.get(runtimeId),
      });
    }
  };
}
