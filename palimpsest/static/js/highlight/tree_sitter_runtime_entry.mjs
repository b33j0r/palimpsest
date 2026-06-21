import { Language, Parser } from "web-tree-sitter";

let initialized = null;

export async function createTreeSitterRuntime({ wasmUrl, engineWasmUrl }) {
  if (!initialized) {
    initialized = Parser.init({
      locateFile(scriptName) {
        return scriptName.endsWith(".wasm") ? engineWasmUrl : scriptName;
      },
    });
  }
  await initialized;

  const language = await Language.load(wasmUrl);
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
