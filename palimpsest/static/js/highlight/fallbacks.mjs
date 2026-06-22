import { highlightPlain } from "./tokenizer.mjs";
import { registerLanguageFallbackHighlighters } from "./fallback_languages.mjs";
import { registerParserGrammarFallbackHighlighters } from "./fallback_parser_grammars.mjs";

export function registerFallbackHighlighters(registry) {
  registerParserGrammarFallbackHighlighters(registry);
  registerLanguageFallbackHighlighters(registry);

  registry.register({
    id: "plain",
    label: "Plain text",
    match: () => true,
    highlight: highlightPlain,
  });
}
