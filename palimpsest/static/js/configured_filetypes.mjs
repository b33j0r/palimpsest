export function normalizeConfiguredFiletypes(appState) {
  return (appState.filetypes || []).map((filetype) => ({
    ...filetype,
    parser: filetype.parser || (filetype.grammar_files?.length ? filetype.id : null),
  }));
}

export function registerConfiguredFiletypeHighlighters(registry, filetypes, highlightPlain) {
  for (const filetype of filetypes) {
    registry.register({
      id: filetype.id,
      label: filetype.id,
      match: (file) => fileMatchesConfiguredFiletype(file, filetype),
      highlight: highlightPlain,
      configured: true,
      parser: filetype.parser,
    });
  }
}

export function findConfiguredFiletype(file, filetypes) {
  return filetypes.find((filetype) => fileMatchesConfiguredFiletype(file, filetype)) || null;
}

function fileMatchesConfiguredFiletype(file, filetype) {
  return filetype.extensions.some((pattern) => fileMatchesPattern(file, pattern));
}

function fileMatchesPattern(file, pattern) {
  if (pattern.startsWith("*.")) {
    return file.name.endsWith(pattern.slice(1));
  }
  if (pattern.startsWith(".")) {
    return file.suffix === pattern;
  }
  if (!pattern.includes("*")) {
    return file.name === pattern || file.suffix === `.${pattern}`;
  }

  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(file.name);
}
