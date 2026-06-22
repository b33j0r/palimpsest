import { buildParser } from "../api.mjs";
import { findConfiguredFiletype } from "../configured_filetypes.mjs";
import { loadConfiguredParserRuntime, parserConfig, runtimeIdForParser } from "../parser_runtimes.mjs";

const parserBuildSettings = new Map();

export function registerParserBuildCompiler({ compilers, graph, configuredFiletypes }) {
  compilers.registerToolbar((context) => parserBuildToolbar(context, graph, compilers, configuredFiletypes));
  compilers.registerInputHandler((context) => {
    const buildContext = parserBuildContext(context, configuredFiletypes);
    if (buildContext && parserBuildSetting(buildContext.parserId).autocompile) {
      const settings = parserBuildSetting(buildContext.parserId);
      window.clearTimeout(settings.autocompileTimer);
      settings.autocompileTimer = window.setTimeout(() => {
        compilers.compile("parser-build", context);
      }, 500);
    }
  });

  compilers.register({
    id: "parser-build",
    label: "Highlighter build command",
    compile: async (context) => {
      const buildContext = parserBuildContext(context, configuredFiletypes);
      if (!buildContext) {
        return null;
      }

      const { file, parser, parserId } = buildContext;
      const { workspace } = context;
      const runtimeId = runtimeIdForParser(parserId);
      const settings = parserBuildSetting(parserId);

      if (settings.building) {
        workspace.editor.setStatus(`Highlighter build already running for ${parserId}.`);
        return null;
      }

      if (workspace.hasUnsavedChanges?.()) {
        const saved = await workspace.save({ ifDirty: true });
        if (!saved) {
          return null;
        }
      }
      const activeFile = workspace.editor.file || file;

      settings.building = true;
      refreshToolbar(workspace);
      workspace.editor.setStatus(`Building highlighter ${parserId}...`);
      graph.emit("parser:build-started", { workspace, file: activeFile, parserId, runtimeId });
      let build;
      try {
        build = await buildParser(parserId);
        settings.lastBuild = build;
        workspace.showBuildResult?.(build);
        graph.emit("parser:build-finished", { workspace, file: activeFile, parserId, runtimeId, build });
        if (!build.ok) {
          workspace.editor.setStatus(`Highlighter build failed for ${parserId}.`);
          console.error("Palimpsest highlighter build failed", build);
          graph.emit("grammar:compile-failed", { workspace, file: activeFile, build, runtimeId });
          return null;
        }
      } finally {
        settings.building = false;
        refreshToolbar(workspace);
      }

      if (!parser.runtime?.module) {
        workspace.editor.setStatus(`Built highlighter ${parserId}.`);
        graph.emit("grammar:compiled", { workspace, file: activeFile, runtime: null, runtimeId, build });
        return build;
      }

      workspace.editor.setStatus(`Loading ${parserId} runtime...`);
      const runtime = await loadConfiguredParserRuntime({
        appState: context.appState,
        graph,
        grammarPath: activeFile.path,
        parserId,
        runtimes: context.runtimes,
      });
      if (!runtime) {
        workspace.editor.setStatus(`Runtime load failed for ${parserId}.`);
        graph.emit("grammar:runtime-load-failed", { workspace, file: activeFile, runtimeId });
        return null;
      }

      workspace.editor.setStatus(`Loaded ${parserId} runtime.`);
      graph.emit("grammar:compiled", { workspace, file: activeFile, runtime, runtimeId, build });
      return runtime;
    },
  });
}

function parserBuildToolbar(context, graph, compilers, configuredFiletypes) {
  const buildContext = parserBuildContext(context, configuredFiletypes);
  if (!buildContext) {
    return null;
  }

  const { parser, parserId } = buildContext;
  const settings = parserBuildSetting(parserId);
  const fragment = document.createDocumentFragment();
  const parserButton = parserSourceButton({
    context,
    graph,
    parser,
    parserId,
    show: Boolean(buildContext.filetype),
  });

  const compileButton = document.createElement("button");
  compileButton.className = "text-button compact";
  compileButton.type = "button";
  compileButton.textContent = settings.building ? `Building ${parserId}` : "Build highlighter";
  compileButton.title = parser.build.command;
  compileButton.disabled = settings.building;
  compileButton.setAttribute("aria-busy", settings.building ? "true" : "false");
  compileButton.addEventListener("click", () => compilers.compile("parser-build", context));

  const label = document.createElement("label");
  label.className = "toolbar-check";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = settings.autocompile;
  checkbox.addEventListener("change", () => {
    settings.autocompile = checkbox.checked;
    graph.emit("parser:autocompile-changed", { parserId, enabled: settings.autocompile });
    if (settings.autocompile) {
      compilers.compile("parser-build", context);
    }
  });

  const text = document.createElement("span");
  text.textContent = settings.lastBuild
    ? `Autobuild (${settings.lastBuild.ok ? "last OK" : "last failed"})`
    : "Autobuild";

  label.append(checkbox, text);
  if (parserButton) {
    fragment.append(parserButton);
  }
  fragment.append(compileButton, label);
  return fragment;
}

function parserBuildContext(context, configuredFiletypes) {
  if (!context.file) {
    return null;
  }

  const filetype = parserExampleFiletype(context.file, configuredFiletypes);
  const parserId = context.file.parser || filetype?.parser;
  if (!parserId) {
    return null;
  }

  const parser = parserConfig(context.appState, parserId);
  if (!parser?.build?.command) {
    return null;
  }

  return { file: context.file, filetype, parser, parserId };
}

function parserBuildSetting(parserId) {
  if (!parserBuildSettings.has(parserId)) {
    parserBuildSettings.set(parserId, {
      autocompile: false,
      autocompileTimer: null,
      building: false,
      lastBuild: null,
    });
  }
  return parserBuildSettings.get(parserId);
}

function refreshToolbar(workspace) {
  if (!workspace?.editor) {
    return;
  }
  const context = workspace.context();
  workspace.editor.setToolbar(() => workspace.renderToolbar(context), context);
}

function parserSourceButton({ context, graph, parser, parserId, show }) {
  if (!show) {
    return null;
  }

  const parserFilePath = firstParserFile(parser);
  const oppositeWorkspace = oppositePane(context.workspace, graph);
  const button = document.createElement("button");
  button.className = "text-button compact parser-jump-button";
  button.type = "button";
  button.textContent = "Parser";
  button.disabled = !parserFilePath || !oppositeWorkspace;
  button.title = parserFilePath
    ? `Open ${parserFilePath} in the opposite pane`
    : `Parser ${parserId} does not declare a parser source file`;
  button.addEventListener("click", async () => {
    if (!parserFilePath || !oppositeWorkspace) {
      return;
    }
    graph.emit("parser:file-reveal-requested", {
      workspace: context.workspace,
      targetWorkspace: oppositeWorkspace,
      parserId,
      path: parserFilePath,
    });
    const opened = await oppositeWorkspace.revealFile(parserFilePath);
    graph.emit(opened ? "parser:file-revealed" : "parser:file-reveal-cancelled", {
      workspace: context.workspace,
      targetWorkspace: oppositeWorkspace,
      parserId,
      path: parserFilePath,
    });
  });
  return button;
}

export function parserExampleFiletype(file, configuredFiletypes) {
  return findConfiguredFiletype(file, configuredFiletypes);
}

function firstParserFile(parser) {
  return parser?.grammar_files?.[0] || null;
}

function oppositePane(workspace, graph) {
  const side = workspace?.dataset?.workspace;
  if (!side) {
    return null;
  }

  const targetSide = side === "left" ? "right" : side === "right" ? "left" : null;
  if (!targetSide) {
    return null;
  }
  return (graph.get("workspaces") || new Map()).get(targetSide) || null;
}
