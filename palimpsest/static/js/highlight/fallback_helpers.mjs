import { tokenize } from "./tokenizer.mjs";

export function createTokenHighlighter({ id, label, adapters = [], filenames = [], extensions = [], grammar }) {
  return {
    id,
    label,
    match: (file) => adapters.includes(file.adapter) || filenames.includes(file.name) || extensions.includes(file.suffix),
    highlight: (source) => tokenize(source, grammar),
  };
}

export function createFallback(grammar) {
  return (source) => tokenize(source, grammar);
}
