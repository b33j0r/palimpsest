import {loadGrammarMetadata, loadHealth} from "./api.mjs";
import {findConfiguredFiletype, normalizeConfiguredFiletypes, registerConfiguredFiletypeHighlighters} from "./configured_filetypes.mjs";
import {SignalGraph} from "./core/signal_graph.mjs";
import {CompilerRegistry, FallbackHighlighterRegistry, ModeRegistry, RuntimeRegistry} from "./core/registries.mjs";
import {highlightPlain} from "./highlight/tokenizer.mjs";
import {registerFallbackHighlighters} from "./highlight/fallbacks.mjs";
import {registerModes} from "./modes/index.mjs";
import {hydrateConfiguredParserRuntimes, registerConfiguredParserRuntimes} from "./parser_runtimes.mjs";
import {parentPath} from "./utils/path.mjs";
import {createEditorWorkspaceClass} from "./workspace.mjs";

const appState = JSON.parse(document.getElementById("app-state").textContent);
const configuredFiletypes = normalizeConfiguredFiletypes(appState);

let grammarFiles = [];
let grammarFileMap = new Map();

const graph = new SignalGraph();
const runtimes = new RuntimeRegistry({graph});
const compilers = new CompilerRegistry();
const fallbackHighlighters = new FallbackHighlighterRegistry();
const modeRegistry = new ModeRegistry({graph});

graph.set("openedFormats", new Map());
graph.on("editor:file-opened", ({detail}) => {
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
    openedFormats.set(formatId, {...format, modeId: detail.mode.id, paths});
    graph.set("openedFormats", openedFormats);
});

installHealthRefreshController();

registerConfiguredParserRuntimes({appState, runtimes});

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

initializeResizableEditorLayout();
initializeWorkspaces();

function initializeResizableEditorLayout() {
    const shell = document.querySelector(".app-shell");
    const leftWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="left"]');
    const rightWorkspace = document.querySelector('palimpsest-editor-workspace[data-workspace="right"]');

    if (!shell || !leftWorkspace || !rightWorkspace) {
        return;
    }

    const layout = readEditorLayout();
    applyLayoutValue(shell, "--left-sidebar-width", layout.leftSidebarWidth);
    applyLayoutValue(shell, "--right-sidebar-width", layout.rightSidebarWidth);
    applyLayoutValue(shell, "--left-editor-width", layout.leftEditorWidth);
    constrainEditorLayout(shell);

    const leftSidebar = leftWorkspace.querySelector(".group-sidebar");
    const leftEditor = leftWorkspace.querySelector(".editor-pane");
    const rightSidebar = rightWorkspace.querySelector(".group-sidebar");

    if (leftSidebar) {
        installResizeHandle(leftSidebar, {
            label: "Resize examples file list",
            className: "resize-handle-sidebar",
            onStart: () => leftSidebar.getBoundingClientRect().width,
            onResize: (startWidth, deltaX) => {
                setSidebarWidth(shell, "left", startWidth + deltaX);
            },
        });
    }

    if (rightSidebar) {
        installResizeHandle(rightSidebar, {
            label: "Resize grammar file list",
            className: "resize-handle-sidebar",
            onStart: () => rightSidebar.getBoundingClientRect().width,
            onResize: (startWidth, deltaX) => {
                setSidebarWidth(shell, "right", startWidth + deltaX);
            },
        });
    }

    if (leftEditor) {
        installResizeHandle(leftEditor, {
            label: "Move editor split",
            className: "resize-handle-editor",
            onStart: () => leftEditor.getBoundingClientRect().width,
            onResize: (startWidth, deltaX) => {
                setLeftEditorWidth(shell, startWidth + deltaX);
            },
        });
    }
}

function installResizeHandle(container, {label, className, onStart, onResize}) {
    if (container.querySelector(":scope > .resize-handle")) {
        return;
    }

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `resize-handle ${className}`;
    handle.setAttribute("aria-label", label);
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("role", "separator");
    handle.title = label;

    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }

        const startX = event.clientX;
        const startWidth = onStart();
        handle.setPointerCapture(event.pointerId);
        handle.dataset.active = "true";
        document.documentElement.dataset.resizing = "true";
        event.preventDefault();

        const move = (moveEvent) => {
            onResize(startWidth, moveEvent.clientX - startX);
        };
        const stop = () => {
            handle.releasePointerCapture(event.pointerId);
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", stop);
            handle.removeEventListener("pointercancel", stop);
            delete handle.dataset.active;
            delete document.documentElement.dataset.resizing;
            persistEditorLayout();
        };

        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
    });

    handle.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 48 : 16;
        const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction) {
            return;
        }

        event.preventDefault();
        onResize(onStart(), direction * step);
        persistEditorLayout();
    });

    container.append(handle);
}

function setSidebarWidth(shell, side, width) {
    const property = side === "left" ? "--left-sidebar-width" : "--right-sidebar-width";
    const otherProperty = side === "left" ? "--right-sidebar-width" : "--left-sidebar-width";
    const otherSidebarWidth = cssPixelValue(shell, otherProperty, 240);
    const leftEditorWidth = cssPixelValue(shell, "--left-editor-width", null);
    const shellWidth = shell.getBoundingClientRect().width;
    const maxWidth = Math.max(160, shellWidth - otherSidebarWidth - (leftEditorWidth || 320) - 320);
    const nextWidth = clamp(width, 160, Math.min(440, maxWidth));

    shell.style.setProperty(property, `${nextWidth}px`);
    constrainLeftEditorWidth(shell);
}

function setLeftEditorWidth(shell, width) {
    const shellWidth = shell.getBoundingClientRect().width;
    const leftSidebarWidth = cssPixelValue(shell, "--left-sidebar-width", 240);
    const rightSidebarWidth = cssPixelValue(shell, "--right-sidebar-width", 240);
    const maxWidth = Math.max(320, shellWidth - leftSidebarWidth - rightSidebarWidth - 320);
    shell.style.setProperty("--left-editor-width", `${clamp(width, 320, maxWidth)}px`);
}

function constrainLeftEditorWidth(shell) {
    const leftEditorWidth = cssPixelValue(shell, "--left-editor-width", null);
    if (leftEditorWidth !== null) {
        setLeftEditorWidth(shell, leftEditorWidth);
    }
}

function constrainEditorLayout(shell) {
    setSidebarWidth(shell, "left", cssPixelValue(shell, "--left-sidebar-width", 240));
    setSidebarWidth(shell, "right", cssPixelValue(shell, "--right-sidebar-width", 240));
    constrainLeftEditorWidth(shell);
}

function cssPixelValue(element, property, fallback) {
    const value = getComputedStyle(element).getPropertyValue(property).trim();
    if (!value.endsWith("px")) {
        return fallback;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function applyLayoutValue(shell, property, value) {
    if (Number.isFinite(value)) {
        shell.style.setProperty(property, `${value}px`);
    }
}

function readEditorLayout() {
    try {
        return JSON.parse(localStorage.getItem("palimpsest:editor-layout")) || {};
    } catch {
        return {};
    }
}

function persistEditorLayout() {
    const shell = document.querySelector(".app-shell");
    if (!shell) {
        return;
    }

    try {
        localStorage.setItem("palimpsest:editor-layout", JSON.stringify({
            leftSidebarWidth: cssPixelValue(shell, "--left-sidebar-width", null),
            rightSidebarWidth: cssPixelValue(shell, "--right-sidebar-width", null),
            leftEditorWidth: cssPixelValue(shell, "--left-editor-width", null),
        }));
    } catch {
        // Layout persistence is a convenience; resizing should still work without storage.
    }
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

async function initializeWorkspaces() {
    await refreshHealth({reason: "startup"});
    grammarFiles = await loadGrammarMetadata();
    grammarFileMap = new Map(grammarFiles.map((file) => [file.path, file]));
    hydrateConfiguredParserRuntimes({appState, graph, runtimes});

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

function installHealthRefreshController() {
    graph.on("projectHealth:changed", ({detail}) => {
        renderHealth(detail.value, {loading: Boolean(graph.get("projectHealthLoading"))});
    });
    graph.on("projectHealthLoading:changed", ({detail}) => {
        renderHealth(graph.get("projectHealth") || null, {loading: detail.value});
    });
    graph.on("parser:build-started", () => {
        graph.set("projectHealthLoading", true);
    });
    graph.on("parser:build-finished", ({detail}) => {
        refreshHealth({reason: "parser-build-finished", parserId: detail.parserId});
    });
}

let healthRefreshActive = false;
let healthRefreshQueued = false;

async function refreshHealth({reason = "manual", parserId = null} = {}) {
    if (healthRefreshActive) {
        healthRefreshQueued = true;
        return graph.get("projectHealth") || null;
    }

    healthRefreshActive = true;
    graph.set("projectHealthLoading", true);
    try {
        const health = await loadHealth();
        graph.set("projectHealth", health);
        graph.emit("project:health-refreshed", {health, reason, parserId});
        return health;
    } finally {
        healthRefreshActive = false;
        graph.set("projectHealthLoading", false);
        if (healthRefreshQueued) {
            healthRefreshQueued = false;
            refreshHealth({reason: "queued"});
        }
    }
}

function renderHealth(health, {loading = false} = {}) {
    const panel = document.querySelector("[data-health-panel]");
    const summary = document.querySelector("[data-health-summary]");
    const body = document.querySelector("[data-health-body]");
    if (!panel || !summary || !body) {
        return;
    }
    if (!health) {
        summary.textContent = loading ? "Checking project health..." : "Project health unavailable";
        return;
    }

    const missingDependencies = (health.dependencies || []).filter((dependency) => !dependency.ok);
    const missingParsers = (health.parsers || []).filter((parser) => !parser.ok);
    panel.dataset.ok = health.ok ? "true" : "false";
    summary.textContent = loading
        ? "Checking project health..."
        : health.ok
        ? "project"
        : `${missingDependencies.length + missingParsers.length || 1} project readiness issue(s)`;

    body.replaceChildren();
    body.append(
        healthPairs([
            ["Config", health.config_path || appState.config_path],
            ["Workspace", health.cwd || appState.cwd],
        ]),
        healthList("Dependencies", health.dependencies || [], (item) => ({
            status: item.ok ? "OK" : "Missing",
            tone: item.ok ? "ok" : "warn",
            name: item.name,
            detail: item.path || item.reason || "",
        })),
        healthList("Parsers", health.parsers || [], (parser) => ({
            status: parser.ok ? "OK" : "Check",
            tone: parser.ok ? "ok" : "warn",
            name: parser.id,
            detail: parser.reason || "",
        })),
    );
}

function healthPairs(items) {
    const list = document.createElement("dl");
    list.className = "health-pairs";
    for (const [label, value] of items) {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const description = document.createElement("dd");

        row.className = "health-pair";
        term.textContent = label;
        description.textContent = value || "unknown";
        row.append(term, description);
        list.append(row);
    }
    return list;
}

function healthList(label, items, renderItem) {
    const wrapper = document.createElement("div");
    const title = document.createElement("p");
    const list = document.createElement("ul");

    title.textContent = label;
    title.className = "health-section-title";
    list.className = "health-list";
    if (!items.length) {
        const empty = document.createElement("li");
        empty.className = "health-check";
        empty.textContent = "No checks";
        list.append(empty);
    } else {
        for (const item of items) {
            const rendered = renderItem(item);
            const row = document.createElement("li");
            const status = document.createElement("span");
            const name = document.createElement("span");
            const detail = document.createElement("span");

            row.className = "health-check";
            status.className = `health-badge health-badge-${rendered.tone}`;
            status.textContent = rendered.status;
            name.className = "health-check-name";
            name.textContent = rendered.name;
            detail.className = "health-check-detail";
            detail.textContent = rendered.detail;
            row.append(status, name);
            if (rendered.detail) {
                row.append(detail);
            }
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
        return {path: configuredFile.path, configured: true};
    }

    let fallback = files[0] ? {path: files[0].path, configured: false} : null;
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
