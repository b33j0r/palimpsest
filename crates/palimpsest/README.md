# palimpsest

Rust-first syntax highlighting SDK for Palimpsest language projects.

This crate is the reusable Rust SDK for language-specific highlighters that can
also run inside the Palimpsest workbench. A language project owns its grammar,
parser, AST, and capture choices. This crate owns the token schema, span
conversion, JSON boundary, and helper APIs that make one highlighter usable from
tests, CLIs, servers, editors, and the browser workbench.

The recommended adapter shape is:

```rust
pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String>;
pub fn parse_tokens_json(source: &str) -> String;

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String;
```

`parse_tokens` is the reusable Rust API. `parse_tokens_json` is the stable JSON
boundary. `parse_to_json` is the Palimpsest workbench/WASM export.

## Runtime Contract

Palimpsest imports a browser-loadable `wasm-bindgen` module and calls the
configured parse export with the full source text:

```rust
#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String
```

The function should return one of these JSON strings:

```json
{ "ok": true, "tokens": [] }
```

```json
{ "ok": false, "error": "parse error text" }
```

Each token produced by this crate contains:

- `capture`: logical capture name, such as `function`, `symbol`, or `string`.
- `start` / `end`: UTF-8 byte offsets from Pest.
- `start_utf16` / `end_utf16`: JavaScript string offsets used by the browser.
- `start_line` / `start_col` and `end_line` / `end_col`: Pest line/column spans.
- `text`: the matched source text.

Palimpsest maps `capture` through `highlight_captures` in `palimpsest.toml` to
CSS token classes.

## Public Helpers

Use `TokenSink` when walking an AST or parser output by hand:

```rust
use palimpsest::{HighlightToken, TokenSink};

pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String> {
    let ast = parse_my_language(source).map_err(|error| error.to_string())?;
    let mut tokens = TokenSink::new(source);

    walk_ast(&ast, &mut tokens);
    Ok(tokens.into_tokens())
}

fn walk_ast(ast: &Ast, tokens: &mut TokenSink<'_>) {
    tokens.push_range("keyword", ast.keyword_start, ast.keyword_end);
    tokens.push_char_before("punctuation.bracket", '[', ast.pattern_start, ast.statement_start);
    tokens.push_char_after("punctuation.bracket", ']', ast.pattern_end, ast.statement_end);
}
```

Useful primitives:

- `token_from_byte_range(source, capture, start, end)` builds one full token.
- `push_range(source, capture, start, end, tokens)` appends a valid byte range.
- `sort_and_dedupe(tokens)` normalizes token order and removes duplicates.
- `TokenSink::push_range` appends spans without repeatedly passing `source`.
- `TokenSink::push_char_before` and `TokenSink::push_char_after` find nearby
  punctuation within a bounded source range.
- `TokenSink::push_char_at_or_before` and `TokenSink::push_char_at_or_after`
  cover punctuation whose parser span may point at either the delimiter or the
  neighboring semantic node.

Use text-range helpers for punctuation or delimiters that are not represented in
your AST. Prefer AST spans for semantic captures.

## Cargo Setup

In a parser crate:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
palimpsest = { path = "../../../palimpsest/crates/palimpsest" }
pest = "2.8.6"
pest_derive = "2.8.6"
wasm-bindgen = "0.2.125"
```

Adjust the `path` for your workspace layout.

## Pest Example

For a new Rust+Pest DSL, use a dedicated highlighter/parser crate:

```text
crates/my-language-highlighter/
├── Cargo.toml
└── src/
    ├── language.pest
    └── lib.rs
```

`Cargo.toml`:

```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
palimpsest = { path = "../../../palimpsest/crates/palimpsest" }
pest = "2.8.6"
pest_derive = "2.8.6"
wasm-bindgen = "0.2.125"
```

Given a grammar like:

```pest
WHITESPACE = _{ " " | "\t" | "\r" | "\n" }
program = { SOI ~ expr* ~ EOI }
expr = _{ list | string | number | symbol }
list = { "(" ~ symbol? ~ expr* ~ ")" }
symbol = @{ ASCII_ALPHA ~ (ASCII_ALPHANUMERIC | "-" | "_")* }
number = @{ ASCII_DIGIT+ ~ ("." ~ ASCII_DIGIT+)? }
string = @{ "\"" ~ (!"\"" ~ ANY)* ~ "\"" }
```

Expose a wasm parser like this:

```rust
use palimpsest::{parse_error_json, parse_success_json, pest_tokens, HighlightToken};
use pest::Parser;
use pest_derive::Parser;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Parser)]
#[grammar = "language.pest"]
pub struct LanguageParser;

pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String> {
    let pairs = LanguageParser::parse(Rule::program, source)
        .map_err(|error| error.to_string())?;
    Ok(pest_tokens(source, pairs, capture_for_rule))
}

pub fn parse_tokens_json(source: &str) -> String {
    match parse_tokens(source) {
        Ok(tokens) => parse_success_json(&tokens),
        Err(error) => parse_error_json(error),
    }
}

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String {
    parse_tokens_json(source)
}

fn capture_for_rule(rule: Rule) -> Option<&'static str> {
    match rule {
        Rule::symbol => Some("symbol"),
        Rule::number => Some("number"),
        Rule::string => Some("string"),
        _ => None,
    }
}
```

Only return `Some(capture)` for Pest rules that should become highlight spans.
Silent grammar rules and structural rules can return `None`.

Add tests against real sample files:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const EXAMPLE: &str = include_str!("../../../examples/demo.my");

    #[test]
    fn highlights_core_language_shapes() {
        let tokens = parse_tokens(EXAMPLE).expect("example should parse");
        assert!(tokens.iter().any(|token| token.capture == "symbol"));
        assert!(tokens.iter().any(|token| token.capture == "string"));
        assert!(tokens.iter().any(|token| token.capture == "number"));
    }
}
```

## AST-Backed Example

For a production language that already has a parser and AST, use the normal
parser and walk the AST into captures:

```rust
use palimpsest::{parse_error_json, parse_success_json, HighlightToken, TokenSink};
use wasm_bindgen::prelude::wasm_bindgen;

pub fn parse_tokens(source: &str) -> Result<Vec<HighlightToken>, String> {
    let ast = parse_file(source).map_err(|error| error.to_string())?;
    let mut tokens = TokenSink::new(source);

    collect_file(&ast, &mut tokens);
    Ok(tokens.into_tokens())
}

pub fn parse_tokens_json(source: &str) -> String {
    match parse_tokens(source) {
        Ok(tokens) => parse_success_json(&tokens),
        Err(error) => parse_error_json(error),
    }
}

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String {
    parse_tokens_json(source)
}

fn collect_file(ast: &File, tokens: &mut TokenSink<'_>) {
    for statement in &ast.statements {
        tokens.push_range("keyword", statement.keyword.start, statement.keyword.end);
        tokens.push_range("symbol", statement.name.start, statement.name.end);
        tokens.push_char_after("operator", '=', statement.name.end, statement.value.start);
    }
}
```

Komrad follows this pattern in its `komrad-highlighter` crate: it parses with
the real Komrad parser, walks AST spans for semantic captures, and uses bounded
text searches only for handler punctuation not represented directly in the AST.

## Build For Palimpsest Highlight

Build the parser crate for wasm, then run `wasm-bindgen`:

```sh
cargo build -p parser --target wasm32-unknown-unknown
wasm-bindgen \
  --target web \
  --out-dir target/palimpsest/my-language \
  --out-name parser \
  target/wasm32-unknown-unknown/debug/parser.wasm
```

Then configure Palimpsest and build through the highlighter pipeline:

```toml
[[parsers.my_language]]
adapter = "pest"
grammar_files = ["./crates/parser/src/*.pest"]
highlight_captures = { symbol = "variable", string = "string", number = "number" }

[parsers.my_language.build]
preset = "cargo-wasm-bindgen"
package = "parser"

[parsers.my_language.runtime]
parse_export = "parse_to_json"

[[filetypes.my_language]]
extensions = ["*.my"]
parser = "my_language"
highlight_captures = { symbol = "variable", string = "string", number = "number" }
```

The preset derives the `wasm-bindgen` output paths and `runtime.module`.
Use `build.command` for custom build flows that do not fit this Rust/WASM
layout.

```sh
palimpsest highlight check
palimpsest highlight build my_language
```

When the workbench or CLI builds this highlighter, Palimpsest imports
`parser.js`, loads the companion `.wasm`, calls `parse_to_json`, and renders
matching source files with the returned spans.
