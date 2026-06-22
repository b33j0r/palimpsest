import { highlightPlain } from "../highlight/tokenizer.mjs";
import { runtimeIdForParser } from "../parser_runtimes.mjs";
import { findConfiguredFiletype } from "../configured_filetypes.mjs";
import { registerParserBuildCompiler } from "./parser_build.mjs";

export { parserExampleFiletype } from "./parser_build.mjs";

export function registerModes({ modeRegistry, fallbackHighlighters, runtimes, compilers, graph, configuredFiletypes }) {
  modeRegistry.register(createMajorMode({
    id: "pest",
    label: "Pest",
    adapters: ["pest"],
    extensions: [".pest"],
    highlighterId: "pest",
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

  registerParserBuildCompiler({ compilers, graph, configuredFiletypes });
}

function runtimeIdForFile(file, filetypes) {
  const filetype = findConfiguredFiletype(file, filetypes);
  if (!filetype?.parser) {
    return null;
  }
  return runtimeIdForParser(filetype.parser);
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
