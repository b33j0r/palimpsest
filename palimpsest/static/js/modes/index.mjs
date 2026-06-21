import { findConfiguredFiletype } from "../configured_filetypes.mjs";
import { buildParser } from "../api.mjs";
import { highlightPlain } from "../highlight/tokenizer.mjs";
import { loadWasmParserRuntime } from "../highlight/wasm_runtime.mjs";

const pestSettings = {
  autocompile: false,
};

export function registerModes({ modeRegistry, fallbackHighlighters, runtimes, compilers, graph, configuredFiletypes }) {
  modeRegistry.register(createMajorMode({
    id: "pest",
    label: "Pest",
    adapters: ["pest"],
    extensions: [".pest"],
    highlighterId: "pest",
    toolbar: (context) => pestToolbar(context, graph, compilers),
    compilerId: "pest-project-format",
    onInput: (context) => {
      if (pestSettings.autocompile) {
        compilers.compile(context.mode.compilerId, context);
      }
    },
  }));

  modeRegistry.register({
    id: "project-format",
    label: "Project format",
    match: (file) => {
      const runtimeId = runtimeIdForFile(file, configuredFiletypes);
      return Boolean(runtimeId && runtimes.get(runtimeId)?.ready);
    },
    runtimeIds: (context) => {
      const runtimeId = runtimeIdForFile(context.file, configuredFiletypes);
      return runtimeId ? [runtimeId] : [];
    },
    format: (file) => fallbackHighlighters.detect(file),
    highlight: (source, context) => {
      const runtimeId = runtimeIdForFile(context.file, configuredFiletypes);
      return runtimes.get(runtimeId)?.highlight(source) || highlightPlain(source);
    },
    status: (context) => {
      const runtimeId = runtimeIdForFile(context.file, configuredFiletypes);
      return `${runtimes.get(runtimeId)?.label || "Project format"} active.`;
    },
  });

  modeRegistry.register({
    id: "generic",
    label: "Generic",
    match: () => true,
    format: (file) => fallbackHighlighters.detect(file),
    highlight: (source, context) => context.format.highlight(source, context),
    status: (context) => `${context.format.label} mode.`,
  });

  compilers.register({
    id: "pest-project-format",
    label: "Pest project-format compiler",
    compile: async (context) => {
      const { file, workspace } = context;
      if (!file || workspace.editor.mode.id !== "pest") {
        return null;
      }

      const parserId = file.parser || "project-format";
      const runtimeId = `parser:${parserId}`;
      const parser = parserConfig(context.appState, parserId);
      if (!parser) {
        workspace.editor.setStatus(`No parser config found for ${parserId}.`);
        return null;
      }

      workspace.editor.setStatus(`Building ${parserId}...`);
      const build = await buildParser(parserId);
      if (!build.ok) {
        workspace.editor.setStatus(`Build failed for ${parserId}.`);
        console.error("Palimpsest parser build failed", build);
        graph.emit("grammar:compile-failed", { workspace, file, build, runtimeId });
        return null;
      }

      let wasmRuntime;
      try {
        workspace.editor.setStatus(`Loading ${parserId} runtime...`);
        wasmRuntime = await loadWasmParserRuntime({
          parser,
          captureMap: captureMapForParser(context.appState, parserId),
        });
      } catch (error) {
        workspace.editor.setStatus(`Runtime load failed for ${parserId}.`);
        console.error("Palimpsest parser runtime load failed", error);
        graph.emit("grammar:runtime-load-failed", { workspace, file, error, runtimeId });
        return null;
      }
      const runtime = runtimes.update(runtimeId, {
        grammarPath: file.path,
        label: `${parserId} wasm runtime`,
        highlight: wasmRuntime.highlight,
        captureMap: wasmRuntime.captureMap,
        parse: wasmRuntime.parse,
        ready: true,
      });

      workspace.editor.setStatus(`Loaded ${parserId} runtime.`);
      graph.emit("grammar:compiled", { workspace, file, runtime, runtimeId, build });
      return runtime;
    },
  });
}

function runtimeIdForFile(file, filetypes) {
  const filetype = findConfiguredFiletype(file, filetypes);
  if (!filetype?.parser) {
    return null;
  }
  return `parser:${filetype.parser}`;
}

function captureMapForParser(appState, parserId) {
  const parser = (appState.parsers || []).find((candidate) => candidate.id === parserId);
  const filetypes = (appState.filetypes || []).filter((filetype) =>
    filetype.parser === parserId || (!filetype.parser && filetype.id === parserId),
  );

  return Object.assign(
    {},
    parser?.highlight_captures || {},
    ...filetypes.map((filetype) => filetype.highlight_captures || {}),
  );
}

function parserConfig(appState, parserId) {
  return (appState.parsers || []).find((candidate) => candidate.id === parserId) || null;
}

function pestToolbar(context, graph, compilers) {
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

function createMajorMode({ id, label, adapters = [], filenames = [], extensions = [], highlighterId, toolbar, compilerId, onInput }) {
  return {
    id,
    label,
    match: (file) => adapters.includes(file.adapter) || filenames.includes(file.name) || extensions.includes(file.suffix),
    highlighterId,
    highlight: (source, context) => context.format.highlight(source, context),
    toolbar,
    compilerId,
    onInput,
  };
}
