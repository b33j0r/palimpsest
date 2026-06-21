# Palimpsest

Palimpsest is a browser workbench for developing language grammars against real
project files. It opens a project configured with `palimpsest.toml`, shows two
file browser/editor panes, and can load project-specific parser runtimes for
syntax highlighting.

## Run

Install the command from a local checkout:

```sh
uv tool install --editable .
```

Then run it from a project that contains `palimpsest.toml`:

```sh
cd ../example-language
palimpsest
```

Open `http://127.0.0.1:5000`.

During Palimpsest development, run the command through `uv` from this
repository:

```sh
uv run palimpsest
uv run palimpsest ../example-language
uv run palimpsest --config ../example-language/palimpsest.toml
```

## Project Configuration

A project config declares example files, parser runtimes, and the filetypes
that should use those parsers.

```toml
examples_dir = "./examples"

[capture_maps.my_language]
function = "function"
symbol = "variable"
string = "string"
number = "number"
keyword = "keyword"

[[parsers.my_language]]
adapter = "pest"
grammar_files = ["./crates/parser/src/*.pest"]
highlight_captures = "my_language"

[parsers.my_language.build]
command = "cargo build -p parser --target wasm32-unknown-unknown && wasm-bindgen --target web --out-dir target/palimpsest/my-language --out-name parser target/wasm32-unknown-unknown/debug/parser.wasm"
outputs = [
  "./target/palimpsest/my-language/parser.js",
  "./target/palimpsest/my-language/parser_bg.wasm",
]

[parsers.my_language.runtime]
module = "./target/palimpsest/my-language/parser.js"
parse_export = "parse_to_json"

[[filetypes.my_language]]
extensions = ["*.my"]
parser = "my_language"
```

`grammar_files` accepts files, directories, and glob patterns, including
recursive patterns such as `./crates/parser/**/*.pest`. Grammar files show build
controls when their parser has a configured build command.

`runtime.module` points at the browser-loadable JavaScript module produced by
`wasm-bindgen --target web`. The module should export the parser function named
by `parse_export`. Palimpsest calls that function with source text and expects a
JSON string:

```json
{ "ok": true, "tokens": [] }
```

or:

```json
{ "ok": false, "error": "parse failed" }
```

The Rust crate in `crates/palimpsest` provides the shared token schema and Pest
span helpers for parser runtimes.

## Highlighting

Parser runtimes emit logical captures such as `keyword`, `string`,
`function`, or `capture.variable`. `capture_maps` translate those captures to
Palimpsest token classes. Dotted capture names become dash-separated CSS
classes; for example, `punctuation.delimiter` becomes
`tok-punctuation-delimiter`.

Configured filetypes inherit their parser's resolved capture map by default.
Use filetype-level capture maps only when a filetype needs different styling
from its parser.

Files without a loaded parser runtime use the fallback highlighter registry.
That registry covers common source formats through Highlight.js and keeps local
tokenizers for grammar-oriented formats such as Pest, Lezer, Tree-sitter
grammar files, and plain text.

## Workbench Behavior

The UI has two file browser/editor pairs. The left browser starts at
`examples_dir`. The right browser starts near the first configured grammar file
and opens that file when available.

Both panes share the same browsing, editing, mode detection, and highlighting
behavior. Files with configured filetypes switch from fallback highlighting to
parser-runtime highlighting once their parser module is available.

At startup, Palimpsest imports configured runtime modules that already exist. If
a runtime has not been built yet, the filetype remains usable with fallback
highlighting until the parser build succeeds.

## Code Layout

- `palimpsest/config.py` loads and validates `palimpsest.toml`.
- `palimpsest/models.py` defines typed API response models.
- `palimpsest/api.py` serves app state, directory listings, grammar discovery,
  and file content.
- `palimpsest/ui.py` serves the HTML shell.
- `palimpsest/static/js/app.mjs` bootstraps the browser workbench.
- `palimpsest/static/js/core/` contains signal and registry primitives.
- `palimpsest/static/js/highlight/` contains Highlight.js integration and local
  fallback tokenizers.
- `palimpsest/static/js/modes/` contains major-mode and compiler wiring.
- `palimpsest/static/js/parser_runtimes.mjs` registers and loads configured
  parser runtimes.
- `palimpsest/static/js/workspace.mjs` defines the reusable browser/editor
  custom element.
