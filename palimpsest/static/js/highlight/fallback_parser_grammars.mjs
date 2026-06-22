import { highlightLezerGrammar } from "./lezer_grammar.mjs";
import { javascriptGrammar } from "./tokenizer.mjs";
import { createTokenHighlighter } from "./fallback_helpers.mjs";

export function registerParserGrammarFallbackHighlighters(registry) {
  registry.register(createTokenHighlighter({
    id: "pest",
    label: "Pest",
    adapters: ["pest"],
    extensions: [".pest"],
    grammar: {
      lineComment: "//",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["SOI", "EOI", "WHITESPACE", "COMMENT", "ANY"]),
      operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "~", "!", "@", "_", "$", "^"]),
    },
  }));

  registry.register({
    id: "lezer",
    label: "Lezer",
    match: (file) => file.adapter === "lezer" || file.suffix === ".grammar",
    highlight: highlightLezerGrammar,
  });

  registry.register(createTokenHighlighter({
    id: "tree-sitter",
    label: "Tree-sitter",
    adapters: ["tree-sitter"],
    filenames: ["grammar.js", "grammar.json"],
    grammar: javascriptGrammar(["grammar", "seq", "choice", "repeat", "optional", "token", "prec"]),
  }));
}
