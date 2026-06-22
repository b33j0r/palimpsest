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

    const toolbar = renderToolbar(context);
    if (!toolbar) {
      return;
    }

    this.toolbar.hidden = false;
    this.toolbar.append(toolbar);
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

      this.dirty = false;
      this.emptyTitle = this.dataset.emptyTitle || "No file selected";
      this.savedContent = "";
      this.unsubscribers = [
        graph.on("editor:changed", ({ detail }) => this.handleEditorChanged(detail)),
        graph.on("editor:file-cleared", ({ detail }) => this.handleFileCleared(detail)),
        graph.on("editor:file-opened", ({ detail }) => this.handleFileOpened(detail)),
        graph.on("editor:file-saved", ({ detail }) => this.handleFileSaved(detail)),
        graph.on("editor:dirty-changed", ({ detail }) => this.handleDirtyChanged(detail)),
        graph.on("runtime:changed", ({ detail }) => this.handleRuntimeChange(detail.runtime.id)),
        graph.on("workspaces:changed", () => this.handleWorkspaceRegistryChanged()),
      ];

      const sourceTitle = this.querySelector("[data-source-title]");
      const sidebar = this.querySelector(".group-sidebar");
      const editorPane = this.querySelector(".editor-pane");
      this.saveButton = this.createSaveButton();
      this.buildResult = this.querySelector("[data-build-result]");
      this.buildSummary = this.querySelector("[data-build-summary]");
      this.buildMeta = this.querySelector("[data-build-meta]");
      this.buildOutput = this.querySelector("[data-build-output]");
      this.beforeUnloadHandler = (event) => this.handleBeforeUnload(event);
      const textarea = this.querySelector("[data-editor]");

      sourceTitle.id = `${this.dataset.workspace}-source-title`;
      sidebar.dataset.region = this.dataset.workspace;
      sidebar.setAttribute("aria-label", `${this.dataset.workspace} files`);
      editorPane.dataset.region = this.dataset.workspace;
      editorPane.setAttribute("aria-labelledby", sourceTitle.id);

      sourceTitle.textContent = this.emptyTitle;
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
      registerWorkspace(graph, this);

      this.renderSaveButtonState(false);
      this.saveButton.addEventListener("click", () => this.save());
      this.editor.setToolbar(() => this.renderToolbar(this.context()), this.context());
      window.addEventListener("beforeunload", this.beforeUnloadHandler);
    }

    disconnectedCallback() {
      for (const unsubscribe of this.unsubscribers || []) {
        unsubscribe();
      }
      unregisterWorkspace(graph, this);
      if (this.beforeUnloadHandler) {
        window.removeEventListener("beforeunload", this.beforeUnloadHandler);
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

    async openDirectory(path, { confirm = true } = {}) {
      if (confirm && !this.confirmDiscardUnsavedChanges("open another directory")) {
        return false;
      }
      return this.browser.open(path);
    }

    async openFile(path, { confirm = true } = {}) {
      if (confirm && !this.confirmDiscardUnsavedChanges("open another file")) {
        return false;
      }
      this.editor.clear(path);
      this.clearBuildResult();
      this.editor.setToolbar(() => this.renderToolbar(this.context()), this.context());
      graph.emit("editor:file-cleared", { workspace: this });
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
      this.editor.setToolbar(() => this.renderToolbar(context), context);
      this.browser.markActive();
      graph.emit("editor:file-opened", { workspace: this, file: enrichedFile, mode, format, content: file.content });
      return true;
    }

    async revealFile(path) {
      if (!this.confirmDiscardUnsavedChanges("open another file")) {
        return false;
      }

      const directory = parentPath(path);
      if (directory !== null) {
        const openedDirectory = await this.openDirectory(directory, { confirm: false });
        if (!openedDirectory) {
          return false;
        }
      }
      return this.openFile(path, { confirm: false });
    }

    async save({ ifDirty = false } = {}) {
      if (!this.editor.file) {
        this.editor.setStatus("No file selected.");
        return false;
      }
      if (ifDirty && !this.hasUnsavedChanges()) {
        return true;
      }

      this.editor.setStatus("Saving...");
      const content = this.editor.textarea.value;
      const response = await fetch("/api/file", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: this.editor.file.path,
          content,
        }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        this.editor.setStatus(detail?.message || detail?.description || "Save failed.");
        return false;
      }

      const file = await response.json();
      this.editor.file = { ...this.editor.file, ...file };
      this.editor.title.textContent = `${file.path} (${file.size} B)`;
      this.editor.setStatus("Saved.");
      this.browser.markActive();
      graph.emit("editor:file-saved", {
        workspace: this,
        file: this.editor.file,
        content,
        mode: this.editor.mode,
      });
      return true;
    }

    confirmDiscardUnsavedChanges(action) {
      if (!this.hasUnsavedChanges()) {
        return true;
      }
      return window.confirm(`This pane has unsaved changes. Save or discard them before you ${action}.`);
    }

    handleBeforeUnload(event) {
      if (!this.hasUnsavedChanges()) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
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

    renderToolbar(context) {
      const toolbar = document.createDocumentFragment();
      const leftItems = document.createElement("div");
      const rightItems = document.createElement("div");
      const modeControls = context.mode.toolbar?.(context);
      const compilerControls = compilers.toolbar(context);

      leftItems.className = "mode-toolbar-items mode-toolbar-items-left";
      rightItems.className = "mode-toolbar-items mode-toolbar-items-right";

      if (modeControls) {
        leftItems.append(modeControls);
      }
      if (compilerControls) {
        leftItems.append(compilerControls);
      }

      rightItems.append(this.saveButton);
      toolbar.append(leftItems, rightItems);
      return toolbar;
    }

    createSaveButton() {
      const button = document.createElement("button");
      button.className = "text-button compact save-button";
      button.dataset.saveButton = "";
      button.type = "button";
      button.textContent = "Save";
      return button;
    }

    handleInput() {
      graph.emit("editor:changed", {
        workspace: this,
        file: this.editor.file,
        content: this.editor.textarea.value,
        mode: this.editor.mode,
      });

      this.editor.mode.onInput?.(this.context());
      compilers.onInput(this.context());
    }

    hasUnsavedChanges() {
      return Boolean(this.editor.file) && this.editor.textarea.value !== this.savedContent;
    }

    updateDirtyState() {
      const dirty = this.hasUnsavedChanges();
      if (dirty === this.dirty) {
        return;
      }

      this.dirty = dirty;
      graph.emit("editor:dirty-changed", {
        workspace: this,
        file: this.editor.file,
        dirty,
      });
    }

    handleEditorChanged(detail) {
      if (detail.workspace !== this) {
        return;
      }
      this.updateDirtyState();
    }

    handleFileOpened(detail) {
      if (detail.workspace !== this) {
        return;
      }
      this.savedContent = detail.content ?? this.editor.textarea.value;
      this.updateDirtyState();
    }

    handleFileCleared(detail) {
      if (detail.workspace !== this) {
        return;
      }
      this.savedContent = "";
      this.updateDirtyState();
    }

    handleFileSaved(detail) {
      if (!this.editor.file || detail.file?.path !== this.editor.file.path) {
        return;
      }
      if (typeof detail.content === "string") {
        this.savedContent = detail.content;
      }
      this.updateDirtyState();
    }

    handleDirtyChanged(detail) {
      if (detail.workspace !== this) {
        return;
      }
      this.renderSaveButtonState(detail.dirty);
    }

    renderSaveButtonState(dirty) {
      if (!this.saveButton) {
        return;
      }
      this.saveButton.dataset.dirty = dirty ? "true" : "false";
      this.saveButton.title = dirty ? "Unsaved changes" : "No unsaved changes";
    }

    handleWorkspaceRegistryChanged() {
      if (!this.editor) {
        return;
      }
      const context = this.context();
      this.editor.setToolbar(() => this.renderToolbar(context), context);
    }

    showBuildResult(build) {
      if (!this.buildResult || !build) {
        return;
      }

      this.buildResult.hidden = false;
      this.buildResult.dataset.ok = build.ok ? "true" : "false";
      this.buildSummary.textContent = build.ok
        ? `Highlighter build succeeded for ${build.parser} in ${build.elapsed_ms ?? "?"} ms`
        : `Highlighter build failed for ${build.parser}`;

      this.buildMeta.replaceChildren();
      for (const [label, value] of [
        ["Command", build.command],
        ["CWD", build.cwd],
        ["Exit code", build.returncode ?? "none"],
        ["Elapsed", `${build.elapsed_ms ?? "?"} ms`],
        ["Outputs", outputSummary(build.outputs || [])],
      ]) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = label;
        description.textContent = String(value ?? "");
        this.buildMeta.append(term, description);
      }

      const output = [build.stdout, build.stderr].filter(Boolean).join("\n");
      this.buildOutput.textContent = output || "No build output.";
      this.buildResult.open = !build.ok;
    }

    clearBuildResult() {
      if (!this.buildResult) {
        return;
      }
      this.buildResult.hidden = true;
      this.buildResult.open = false;
      this.buildSummary.textContent = "";
      this.buildMeta.replaceChildren();
      this.buildOutput.textContent = "";
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
        this.editor.setToolbar(() => this.renderToolbar(context), context);
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

function outputSummary(outputs) {
  if (!outputs.length) {
    return "No declared outputs";
  }
  return outputs
    .map((output) => `${output.exists ? "OK" : "Missing"} ${output.path}${output.size ? ` (${output.size} B)` : ""}`)
    .join(", ");
}

function registerWorkspace(graph, workspace) {
  const workspaces = new Map(graph.get("workspaces") || []);
  workspaces.set(workspace.dataset.workspace, workspace);
  graph.set("workspaces", workspaces);
}

function unregisterWorkspace(graph, workspace) {
  const workspaces = new Map(graph.get("workspaces") || []);
  if (workspaces.get(workspace.dataset.workspace) !== workspace) {
    return;
  }
  workspaces.delete(workspace.dataset.workspace);
  graph.set("workspaces", workspaces);
}
