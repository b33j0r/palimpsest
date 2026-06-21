# Principles

- Keep modules decoupled, extensible, and easy to replace.
- Prefer data-driven configuration over hardcoded project behavior.
- Split large changes into smaller components with clear responsibilities.

# Adapted Projects

Palimpsest is developed against a small set of language/project workspaces.
Treat these as integration targets, not as code that belongs inside the
Palimpsest repository.

The examples below assume these repositories are checked out as siblings of
`palimpsest`. If your workspace uses a different layout, use the corresponding
local paths.

## `moneyscheme`

Primary test project:

```
../moneyscheme/
```

Project config:

```
../moneyscheme/palimpsest.toml
```

Some tasks may require updating this project or its `palimpsest.toml` so it
continues to work with Palimpsest.

## `komrad-lang`

Komrad integration target:

```
../komrad-lang/
```

Project config:

```
../komrad-lang/palimpsest.toml
```

The Komrad parser adapter is in the Komrad workspace:

```
../komrad-lang/crates/komrad-highlighter/
```

## `komrad-pest`

Secondary test project:

```
../komrad-pest/
```
