const directives = new Set([
  "@cut",
  "@detectDelim",
  "@dialects",
  "@dynamicPrecedence",
  "@else",
  "@export",
  "@extend",
  "@external",
  "@fallback",
  "@isGroup",
  "@isolate",
  "@left",
  "@local",
  "@name",
  "@precedence",
  "@props",
  "@right",
  "@skip",
  "@specialize",
  "@tokens",
  "@top",
]);

const operators = new Set(["{", "}", "(", ")", "[", "]", "<", ">", "=", "|", "*", "+", "?", "/", ",", ".", ":", ";", "!", "$"]);

export function highlightLezerGrammar(source) {
  let html = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (char === "/" && next === "/") {
      const end = nextLineIndex(source, index);
      html += token("comment", source.slice(index, end));
      index = end;
      continue;
    }

    if (char === "@" || isIdentifierStart(char)) {
      const end = identifierEndIndex(source, index);
      const word = source.slice(index, end);
      html += tokenForIdentifier(source, end, word);
      index = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = stringEndIndex(source, index, char);
      html += token("string", source.slice(index, end));
      index = end;
      continue;
    }

    if (char === "$" && next === "[") {
      const end = characterSetEndIndex(source, index + 1);
      html += token("string", source.slice(index, end));
      index = end;
      continue;
    }

    if (char === "[" && previousNonSpace(source, index) === "!") {
      const end = characterSetEndIndex(source, index);
      html += token("string", source.slice(index, end));
      index = end;
      continue;
    }

    if (/\d/.test(char)) {
      const end = numberEndIndex(source, index);
      html += token("number", source.slice(index, end));
      index = end;
      continue;
    }

    if (operators.has(char) || (char === "-" && next === ">")) {
      const end = char === "-" && next === ">" ? index + 2 : index + 1;
      html += token("operator", source.slice(index, end));
      index = end;
      continue;
    }

    html += escapeHtml(char);
    index += 1;
  }

  return html;
}

function tokenForIdentifier(source, end, word) {
  if (directives.has(word)) {
    return token("keyword", word);
  }
  if (nextNonSpace(source, end) === "{") {
    return token(isUppercaseIdentifier(word) ? "type" : "rule", word);
  }
  if (isUppercaseIdentifier(word)) {
    return token("type", word);
  }
  return escapeHtml(word);
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

function characterSetEndIndex(source, start) {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === "\\" && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === "]") {
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

function previousNonSpace(source, start) {
  let index = start - 1;
  while (index >= 0 && /\s/.test(source[index])) {
    index -= 1;
  }
  return source[index] || "";
}

function isUppercaseIdentifier(word) {
  return /^[A-Z]/.test(word);
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
