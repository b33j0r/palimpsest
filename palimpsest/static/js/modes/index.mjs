import { highlightPlain, highlightSourceLike } from "../highlight/tokenizer.mjs";

const pestSettings = {
  autocompile: false,
};

export function registerModes({ modeRegistry, fallbackHighlighters, runtimes, compilers, graph }) {
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
    match: (file, workspace) =>
      workspace.syntaxRole === "source" &&
      Boolean(runtimes.get("project-format")?.ready) &&
      fallbackHighlighters.detect(file).id === "plain",
    runtimeIds: () => ["project-format"],
    highlight: (source) => runtimes.get("project-format")?.highlight(source) || highlightPlain(source),
    status: () => `${runtimes.get("project-format")?.label || "Project format"} active.`,
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
