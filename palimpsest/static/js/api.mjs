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
