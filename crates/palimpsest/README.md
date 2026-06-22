# palimpsest

Shared parser-runtime helpers for Palimpsest language projects.

This crate is the current Rust helper for the `palimpsest highlight` subsystem.
It keeps the existing crate name for compatibility, but conceptually it is the
palimpsest-highlight runtime helper. It focuses on parsers that compile to
WebAssembly and return syntax-highlight spans to Palimpsest. A language project
owns its grammar and rule-to-capture mapping; this crate owns the JSON shape and
span conversion expected by the workbench and highlighter pipeline.

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

#[wasm_bindgen]
pub fn parse_to_json(source: &str) -> String {
    match parse_tokens(source) {
        Ok(tokens) => parse_success_json(&tokens),
        Err(error) => parse_error_json(error),
    }
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
