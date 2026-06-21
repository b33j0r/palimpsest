import { highlightPlain, javascriptGrammar, sourceGrammar, tokenize } from "./tokenizer.mjs";
import { createLibraryHighlighter } from "./library.mjs";

export function registerFallbackHighlighters(registry) {
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

  registry.register(createTokenHighlighter({
    id: "lezer",
    label: "Lezer",
    adapters: ["lezer"],
    extensions: [".grammar"],
    grammar: {
      lineComment: "@comment",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["@top", "@tokens", "@skip", "@detectDelim", "@precedence", "@external"]),
      operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", "."]),
    },
  }));

  registry.register(createTokenHighlighter({
    id: "tree-sitter",
    label: "Tree-sitter",
    adapters: ["tree-sitter"],
    filenames: ["grammar.js", "grammar.json"],
    grammar: javascriptGrammar(["grammar", "seq", "choice", "repeat", "optional", "token", "prec"]),
  }));

  registry.register(createLibraryHighlighter({
    id: "rust",
    label: "Rust",
    extensions: [".rs"],
    fallback: createFallback(sourceGrammar({
      lineComment: "//",
      keywords: ["as", "async", "await", "break", "const", "continue", "crate", "else", "enum", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while"],
    })),
  }));

  registry.register(createLibraryHighlighter({
    id: "c",
    label: "C",
    extensions: [".c", ".h"],
    fallback: createFallback(sourceGrammar({
      lineComment: "//",
      keywords: ["auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum", "extern", "float", "for", "goto", "if", "int", "long", "register", "return", "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void", "volatile", "while"],
    })),
  }));

  registry.register(createLibraryHighlighter({
    id: "python",
    label: "Python",
    extensions: [".py", ".pyi"],
    fallback: createFallback(sourceGrammar({
      lineComment: "#",
      keywords: ["and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield"],
    })),
  }));

  registry.register(createLibraryHighlighter({
    id: "scheme",
    label: "Scheme",
    extensions: [".scm", ".ss", ".sls", ".sps", ".rkt"],
    fallback: createFallback(sourceGrammar({
      lineComment: ";",
      keywords: ["and", "begin", "cond", "define", "define-syntax", "delay", "do", "else", "if", "lambda", "let", "let*", "letrec", "or", "quasiquote", "quote", "set!", "syntax-rules", "unless", "when"],
    })),
  }));

  registry.register(createLibraryHighlighter({
    id: "ini",
    label: "INI",
    extensions: [".ini", ".cfg", ".conf", ".toml"],
    fallback: createFallback({
      lineComment: "#",
      strings: new Set(['"', "'"]),
      ruleAssignment: true,
      keywords: new Set(["true", "false", "yes", "no", "on", "off"]),
      operators: new Set(["=", ":", "[", "]", ".", ","]),
    }),
  }));

  registry.register(createLibraryHighlighter({
    id: "javascript",
    label: "JavaScript",
    extensions: [".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"],
    fallback: createFallback(javascriptGrammar(["async", "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "else", "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in", "instanceof", "let", "new", "null", "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var", "void", "while", "yield"])),
  }));

  registry.register(createLibraryHighlighter({
    id: "css",
    label: "CSS",
    extensions: [".css"],
    fallback: createFallback(sourceGrammar({
      lineComment: null,
      keywords: ["@media", "@supports", "@container", "@layer", "@keyframes", "display", "grid", "flex", "block", "none", "absolute", "relative", "fixed", "sticky", "var", "color-mix"],
    })),
  }));

  registry.register({
    id: "plain",
    label: "Plain text",
    match: () => true,
    highlight: highlightPlain,
  });
}

function createTokenHighlighter({ id, label, adapters = [], filenames = [], extensions = [], grammar }) {
  return {
    id,
    label,
    match: (file) => adapters.includes(file.adapter) || filenames.includes(file.name) || extensions.includes(file.suffix),
    highlight: (source) => tokenize(source, grammar),
  };
}

function createFallback(grammar) {
  return (source) => tokenize(source, grammar);
}
