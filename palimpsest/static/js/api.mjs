export async function fetchFile(path, editor) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    editor.setStatus("Unable to load file.");
    return null;
  }
  return response.json();
}

export async function loadGrammarMetadata() {
  const response = await fetch("/api/grammars");
  if (!response.ok) {
    return [];
  }
  return response.json();
}

export async function loadHealth() {
  const response = await fetch("/api/health");
  if (!response.ok) {
    return {
      ok: false,
      dependencies: [],
      parsers: [],
      error: "Unable to load project health.",
    };
  }
  return response.json();
}

export async function buildParser(parserId) {
  const response = await fetch(`/api/parsers/${encodeURIComponent(parserId)}/build`, {
    method: "POST",
  });
  const result = await response.json().catch(() => ({
    ok: false,
    stderr: "Build endpoint returned an invalid response.",
  }));

  if (!response.ok) {
    result.ok = false;
  }
  return result;
}

export function parserRuntimeModuleUrl(parserId, modulePath) {
  const moduleName = modulePath.split("/").pop();
  const cacheKey = Date.now().toString(36);
  return `/api/parsers/${encodeURIComponent(parserId)}/runtime/${encodeURIComponent(moduleName)}?v=${cacheKey}`;
}
