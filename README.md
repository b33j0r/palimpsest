# Palimpsest

Palimpsest is a workbench for designing language grammars against real project files. It is meant to point at an actual project directory, read a small `palimpsest.toml`, browse that project's examples, and grow into a live syntax-highlighting preview while the grammar changes.

Currently, a project dir's `palimpsest.toml` can declare where examples and grammar files live:

```toml
examples_dir = "./examples"
grammar_files = ["./crates/parser/src/moneyscheme.pest"]
```

`grammar_files` accepts files or directories. Directories are scanned for supported grammar sources. The app currently registers adapter IDs for:

- `pest`: `.pest`
- `tree-sitter`: `grammar.js`, `grammar.json`, `.scm`
- `lezer`: `.grammar`

## Run

```sh
uv run flask --app palimpsest.app run --port 5001
```

Open `http://127.0.0.1:5001`.

## Shape

- `palimpsest/config.py` loads and validates project configuration with Pydantic.
- `palimpsest/models.py` contains typed state, file-browser response models, and grammar-file response models.
- `palimpsest/api.py` serves JSON for app state, directory listings, grammar discovery, and file content.
- `palimpsest/ui.py` serves the browser UI shell.
- `palimpsest/static/js/app.js` owns the browser workbench behavior, including reusable editor controllers and pluggable syntax highlighter adapters.

## Editor Surface

The UI top level is a fixed left-to-right grid with five physical columns:

- Config pane showing the active project root and configured paths.
- Examples file-browser sidebar.
- Example editor.
- Grammar-file sidebar.
- Grammar editor.

The examples and grammar surfaces are two instances of the same browser/editor workspace component, initialized with different starting paths and syntax roles. Both file-browser sidebars show a flat directory listing. Directories open in-place as the sidebar's current directory, and a `..` row lets either browser move upward until it reaches the project root. There is no full-width workspace header and there are no alternate-layout media queries yet; the current layout is intentionally fixed while the core editor grouping is being built.

## Modes and Highlighting

Each editor resolves a major mode through the browser-side mode registry when a file opens. Modes match against grammar adapter metadata, exact filenames, and suffixes, then own syntax highlighting and any editor controls they need. Built-in modes currently cover Pest, Lezer, Tree-sitter grammar files, Rust, C, Python, Scheme, INI/TOML-style config, JavaScript/TypeScript, CSS, project-format sources, and plain text.

Modes can optionally render a toolbar and declare a compiler. The Pest mode uses this for `Compile` and `Autocompile` controls. Compilation runs through a compiler registry, updates a browser-side project-format runtime, and emits graph signals; later backends can replace that compiler with Pest/nom/WASM or server-side work while keeping the editor/workspace contract the same.

The UI has a small signal graph for dataflow-style updates. Editor open/change/save events, runtime changes, and grammar compile events flow through that graph, and opened files are captured by resolved mode so format-specific behavior has a single registry-facing hook. Modes can declare runtime dependencies; when a runtime changes, open editors re-resolve their mode and re-render only when the runtime applies. When a Pest grammar compiles, open source editors can switch to the project-format mode and reload against the updated runtime, which is the path toward live custom parser/highlighter reloads.
