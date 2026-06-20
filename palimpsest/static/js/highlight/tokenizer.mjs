export function highlightPlain(source) {
  return escapeHtml(source);
}

export function highlightSourceLike(source) {
  return tokenize(source, sourceGrammar({
    keywords: ["if", "else", "let", "in", "true", "false", "nil", "and", "or"],
  }));
}

export function sourceGrammar({ lineComment = "//", keywords = [] }) {
  return {
    lineComment,
    strings: new Set(['"', "'", "`"]),
    ruleAssignment: false,
    keywords: new Set(keywords),
    operators: new Set(["{", "}", "(", ")", "[", "]", "=", "|", "*", "+", "?", "/", ",", ".", ":", ";", "-", "<", ">", "!", "&", "%", "#"]),
  };
}

export function javascriptGrammar(extraKeywords = []) {
  return sourceGrammar({
    lineComment: "//",
    keywords: ["module", "exports", ...extraKeywords],
  });
}

export function tokenize(source, grammar) {
  let html = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (grammar.lineComment === "//" && char === "/" && next === "/") {
      const end = nextLineIndex(source, index);
      html += token("comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.lineComment && grammar.lineComment !== "//" && source.startsWith(grammar.lineComment, index)) {
      const end = nextLineIndex(source, index);
      html += token("comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.strings.has(char)) {
      const end = stringEndIndex(source, index, char);
      html += token("string", source.slice(index, end));
      index = end;
      continue;
    }

    if (isIdentifierStart(char) || char === "@") {
      const end = identifierEndIndex(source, index);
      const word = source.slice(index, end);
      const className = tokenClassForWord(source, end, word, grammar);
      html += className ? token(className, word) : escapeHtml(word);
      index = end;
      continue;
    }

    if (/\d/.test(char)) {
      const end = numberEndIndex(source, index);
      html += token("number", source.slice(index, end));
      index = end;
      continue;
    }

    if (grammar.operators.has(char)) {
      html += token("operator", char);
      index += 1;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
}

function tokenClassForWord(source, end, word, grammar) {
  if (grammar.keywords.has(word)) {
    return "keyword";
  }
  if (grammar.ruleAssignment && nextNonSpace(source, end) === "=") {
    return "rule";
  }
  return "";
}

function nextLineIndex(source, start) {
  const end = source.indexOf("\n", start);
  return end === -1 ? source.length : end;
}

function stringEndIndex(source, start, quote) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function identifierEndIndex(source, start) {
  let index = start + 1;
  while (index < source.length && /[\w-]/.test(source[index])) {
    index += 1;
  }
  return index;
}

function numberEndIndex(source, start) {
  let index = start + 1;
  while (index < source.length && /[\d._]/.test(source[index])) {
    index += 1;
  }
  return index;
}

function nextNonSpace(source, start) {
  let index = start;
  while (index < source.length && /\s/.test(source[index])) {
    index += 1;
  }
  return source[index] || "";
}

function token(className, value) {
  return `<span class="tok-${className}">${escapeHtml(value)}</span>`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
