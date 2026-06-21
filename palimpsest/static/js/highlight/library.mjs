import { highlightPlain } from "./tokenizer.mjs";

const languageAliases = new Map([
  ["c", "c"],
  ["css", "css"],
  ["ini", "toml"],
  ["javascript", "javascript"],
  ["python", "python"],
  ["rust", "rust"],
  ["scheme", "scheme"],
]);

export function createLibraryHighlighter({ id, label, adapters = [], filenames = [], extensions = [], fallback }) {
  return {
    id,
    label,
    match: (file) => adapters.includes(file.adapter) || filenames.includes(file.name) || extensions.includes(file.suffix),
    highlight: (source) => highlightWithLibrary(source, languageAliases.get(id) || id, fallback),
  };
}

function highlightWithLibrary(source, language, fallback) {
  const hljs = globalThis.hljs;
  if (!hljs?.getLanguage?.(language)) {
    return fallback?.(source) || highlightPlain(source);
  }

  try {
    return hljs.highlight(source, { language, ignoreIllegals: true }).value;
  } catch (error) {
    console.warn(`Palimpsest highlighter failed for ${language}.`, error);
    return fallback?.(source) || highlightPlain(source);
  }
}
