# Principles

- Must be modular, decoupled, and extensible.
- Must be data-driven.
- Split large things into smaller, manageable components.

# Adapted Projects

Palimpsest is developed against a small set of local language/project
workspaces. Treat these as integration targets, not as code that belongs inside
the Palimpsest repository.

## `moneyscheme`

Primary test project:

```
/Users/brian/Projects/moneyscheme/
```

Project config:

```
/Users/brian/Projects/moneyscheme/palimpsest.toml
```

Some tasks may require updating this project or its `palimpsest.toml` so it
continues to work with Palimpsest.

## `komrad-lang`

Komrad integration target:

```
/Users/brian/Projects/komrad-lang/
```

Project config:

```
/Users/brian/Projects/komrad-lang/palimpsest.toml
```

The Komrad parser adapter crate belongs in the Komrad workspace:

```
/Users/brian/Projects/komrad-lang/crates/komrad-parser-palimpsest/
```

Do not create or keep `komrad-parser-palimpsest` under
`/Users/brian/Projects/palimpsest/crates/`. Palimpsest should provide reusable
support crates and the workbench; language-specific parser adapters belong in
their language workspace.

## `komrad-pest`

Secondary test project:

```
/Users/brian/Projects/komrad-pest/
```
