# Palimpsest

Palimpsest is a browser workbench for developing language grammars against real project files. Point it at a project with a `palimpsest.toml`, browse example files and grammar files side by side, edit either one, and wire custom parsers/highlighters into the editor loop.

## Run

```sh
uv run flask --app palimpsest.app run --port 5001
```

Open `http://127.0.0.1:5001`.

## Project Config

A project config declares examples, parser definitions, and filetypes that use those parsers:

```toml
examples_dir = "./examples"

[[parsers.mscm]]
adapter = "pest"
grammar_files = ["./crates/parser/src/*.pest"]
highlight_captures = { rule = "function", string = "string", number = "number" }

[parsers.mscm.build]
command = "cargo build -p parser"
outputs = ["./target/parser.wasm"]

[[filetypes.mscm]]
extensions = ["*.mscm"]
parser = "mscm"
highlight_captures = { symbol = "variable", keyword = "keyword" }
```

`grammar_files` accepts files, directories, and glob patterns, including recursive patterns like `./crates/parser/**/*.pest`. Top-level `grammar_files` is still accepted for older configs. During the transition, a `[[filetypes.name]]` table may also contain `grammar_files`; in that case the filetype name is treated as the parser id.

`highlight_captures` maps parser output captures to standard editor token classes. Useful targets include `comment`, `string`, `keyword`, `number`, `function`, `method`, `type`, `constructor`, `variable`, `property`, `attribute`, `constant`, `operator`, `punctuation`, and `tag`. Dotted captures follow Tree-sitter-style naming by becoming dash-separated token classes, for example `punctuation.delimiter` maps to `tok-punctuation-delimiter`.

## Workbench

The UI is a fixed five-column workbench:

- Project/config pane.
- Examples file browser.
- Example editor.
- Grammar file browser.
- Grammar editor.

The two browser/editor pairs are instances of the same custom element. Both file browsers are flat directory views: directories open in place, and `..` moves upward until the project root.

## Modes And Highlighting

Editors resolve a major mode when a file opens. Major modes own behavior: toolbars, compiler hooks, and runtime dependencies. Syntax coloring is separate: most files use the generic major mode plus the fallback highlighter registry.

That fallback registry is extensible and config-aware. It includes lightweight built-in tokenizers for common formats such as Rust, C, Python, Scheme, INI/TOML-style config, JavaScript/TypeScript, CSS, Pest, Lezer, Tree-sitter grammar files, and plain text. Configured filetypes such as `*.mscm` are also registered, so project-defined languages participate in the same mode/highlighter pipeline instead of being hardcoded into the app.

The Pest major mode currently provides `Compile` and `Autocompile` controls. Compilation is wired through a browser-side compiler registry and updates a parser-scoped runtime such as `parser:mscm`; later server-side or WASM parser builds can replace that compiler implementation without changing editor/workspace contracts.

## Code Shape

- `palimpsest/config.py` loads and validates `palimpsest.toml`.
- `palimpsest/models.py` defines typed API response models.
- `palimpsest/api.py` serves app state, directory listings, grammar discovery, and file content.
- `palimpsest/ui.py` serves the HTML shell.
- `palimpsest/static/js/app.mjs` bootstraps the browser workbench.
- `palimpsest/static/js/core/` contains signal and registry primitives.
- `palimpsest/static/js/highlight/` contains fallback tokenizers.
- `palimpsest/static/js/modes/` contains major-mode and compiler wiring.
- `palimpsest/static/js/workspace.mjs` contains the reusable browser/editor custom element.
