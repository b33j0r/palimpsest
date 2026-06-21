# Palimpsest

Palimpsest is a browser workbench for developing language grammars against real project files. Point it at a project with a `palimpsest.toml`, browse project files side by side, edit either pane, and wire custom parsers/highlighters into the editor loop.

## Run

Install the workbench command in editable mode:

```sh
uv tool install --editable /Users/brian/Projects/palimpsest
```

Then run it from any project directory that contains a `palimpsest.toml`:

```sh
cd /Users/brian/Projects/moneyscheme
palimpsest
```

Open `http://127.0.0.1:5000`.

For local development from this repository:

```sh
uv run palimpsest
```

To run against another project directory or config file:

```sh
uv run palimpsest /Users/brian/Projects/moneyscheme
uv run palimpsest --config /Users/brian/Projects/moneyscheme/palimpsest.toml
```

## Project Config

A project config declares examples, parser definitions, and filetypes that use those parsers:

```toml
examples_dir = "./examples"

[[parsers.mscm]]
adapter = "pest"
grammar_files = ["./crates/parser/src/*.pest"]
highlight_captures = { rule = "function", string = "string", number = "number" }

[parsers.mscm.build]
command = "cargo build -p parser --target wasm32-unknown-unknown && wasm-bindgen --target web --out-dir target/palimpsest/mscm --out-name parser target/wasm32-unknown-unknown/debug/parser.wasm"
outputs = ["./target/palimpsest/mscm/parser.js", "./target/palimpsest/mscm/parser_bg.wasm"]

[parsers.mscm.runtime]
module = "./target/palimpsest/mscm/parser.js"
parse_export = "parse_to_json"

[[filetypes.mscm]]
extensions = ["*.mscm"]
parser = "mscm"
highlight_captures = { symbol = "variable", keyword = "keyword" }
```

`grammar_files` accepts files, directories, and glob patterns, including recursive patterns like `./crates/parser/**/*.pest`. Top-level `grammar_files` is still accepted for older configs. During the transition, a `[[filetypes.name]]` table may also contain `grammar_files`; in that case the filetype name is treated as the parser id.

`runtime.module` points at the browser-loadable JavaScript module produced by `wasm-bindgen --target web`. The module should export a parser function named by `parse_export`; Palimpsest calls it with source text and expects a JSON string shaped like `{ "ok": true, "tokens": [...] }` or `{ "ok": false, "error": "..." }`. The companion Rust crate at `crates/palimpsest` provides this reusable token schema and Pest span helpers so language projects can depend on Palimpsest instead of copying a private protocol.

`highlight_captures` maps parser output captures to standard editor token classes. Useful targets include `comment`, `string`, `keyword`, `number`, `function`, `method`, `type`, `constructor`, `variable`, `property`, `attribute`, `constant`, `operator`, `punctuation`, and `tag`. Dotted captures follow Tree-sitter-style naming by becoming dash-separated token classes, for example `punctuation.delimiter` maps to `tok-punctuation-delimiter`.

## Workbench

The UI is a fixed four-column workbench with two file browser/editor pairs.

The left browser initially opens the configured examples directory. The right browser initially opens near the first configured grammar file and opens that file when available. After startup, both panes use the same file browsing, editing, mode detection, and highlighting behavior for any project file.

## Modes And Highlighting

Editors resolve a major mode when a file opens. Major modes own behavior: toolbars, compiler hooks, and runtime dependencies. Syntax coloring is separate: most files use the generic major mode plus the fallback highlighter registry.

That fallback registry is extensible and config-aware. It includes lightweight built-in tokenizers for common formats such as Rust, C, Python, Scheme, INI/TOML-style config, JavaScript/TypeScript, CSS, Pest, Lezer, Tree-sitter grammar files, and plain text. Configured filetypes such as `*.mscm` are also registered, so project-defined languages participate in the same mode/highlighter pipeline instead of being hardcoded into the app.

Configured parser runtimes are parser-scoped, such as `parser:mscm`. On startup, Palimpsest attempts to import each configured runtime module that already exists, so source files can enter project-format mode without a manual compile. If an artifact is missing or stale, the runtime stays unavailable and configured filetypes continue using their fallback highlighter.

Files declared in a parser's `grammar_files` show parser build controls when that parser has a configured build command, regardless of their major mode. The build action calls the configured server-side command, serves the configured wasm-bindgen runtime module from the project directory, imports it in the browser through the parser-runtime loader, and updates the parser-scoped runtime. Source files with configured filetypes switch into project-format mode when their parser runtime is ready, so highlighting comes from the loaded wasm parser rather than from a fallback tokenizer.

## Code Shape

- `palimpsest/config.py` loads and validates `palimpsest.toml`.
- `palimpsest/models.py` defines typed API response models.
- `palimpsest/api.py` serves app state, directory listings, grammar discovery, and file content.
- `palimpsest/ui.py` serves the HTML shell.
- `palimpsest/static/js/app.mjs` bootstraps the browser workbench.
- `palimpsest/static/js/core/` contains signal and registry primitives.
- `palimpsest/static/js/highlight/` contains fallback tokenizers.
- `palimpsest/static/js/modes/` contains major-mode and compiler wiring.
- `palimpsest/static/js/parser_runtimes.mjs` contains configured parser runtime registration and loading.
- `palimpsest/static/js/workspace.mjs` contains the reusable browser/editor custom element.
