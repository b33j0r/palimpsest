import assert from "node:assert/strict";
import test from "node:test";

import { FallbackHighlighterRegistry } from "../../palimpsest/static/js/core/registries.mjs";
import { registerFallbackHighlighters } from "../../palimpsest/static/js/highlight/fallbacks.mjs";
import {
  ParserRuntimeLoaderRegistry,
  createDefaultParserRuntimeLoaderRegistry,
  loadConfiguredParserRuntime,
} from "../../palimpsest/static/js/parser_runtimes.mjs";

test("parser runtime loader registry selects matching adapter loaders", async () => {
  const calls = [];
  const registry = new ParserRuntimeLoaderRegistry({
    defaultLoader: {
      id: "wasm",
      load: async ({ parser }) => {
        calls.push(`wasm:${parser.adapter}`);
        return { id: parser.id };
      },
    },
  });
  registry.register({
    id: "lezer",
    match: (parser) => parser.adapter === "lezer",
    load: async ({ parser }) => {
      calls.push(`lezer:${parser.adapter}`);
      return { id: parser.id };
    },
  });
  registry.register({
    id: "tree-sitter",
    match: (parser) => parser.adapter === "tree-sitter",
    load: async ({ parser }) => {
      calls.push(`tree-sitter:${parser.adapter}`);
      return { id: parser.id };
    },
  });

  await registry.load({ parser: { id: "hask", adapter: "lezer" } });
  await registry.load({ parser: { id: "bet", adapter: "tree-sitter" } });
  await registry.load({ parser: { id: "talkie", adapter: "pest" } });
  await registry.load({ parser: { id: "clike", adapter: "nom" } });
  await registry.load({ parser: { id: "custom", adapter: "custom" } });

  assert.deepEqual(calls, [
    "lezer:lezer",
    "tree-sitter:tree-sitter",
    "wasm:pest",
    "wasm:nom",
    "wasm:custom",
  ]);
});

test("default parser runtime loader registry exposes built-in loaders", () => {
  const registry = createDefaultParserRuntimeLoaderRegistry();

  assert.equal(registry.get("lezer").id, "lezer");
  assert.equal(registry.get("tree-sitter").id, "tree-sitter");
  assert.equal(registry.get("pest").id, "pest");
  assert.equal(registry.get("nom").id, "nom");
  assert.equal(registry.get("wasm").id, "wasm");
});

test("loadConfiguredParserRuntime emits missing module errors from built-in loaders", async () => {
  const events = [];
  const graph = {
    emit: (name, detail) => events.push({ name, detail }),
  };
  const runtimes = {
    update: () => {
      throw new Error("runtime update should not be called");
    },
  };

  const runtime = await loadConfiguredParserRuntime({
    appState: {
      parsers: [
        {
          id: "missing_module",
          adapter: "pest",
          runtime: {},
        },
      ],
    },
    graph,
    parserId: "missing_module",
    runtimes,
  });

  assert.equal(runtime, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "parser:runtime-load-failed");
  assert.match(events[0].detail.error.message, /does not declare a runtime module/);
});

test("loadConfiguredParserRuntime emits runtime load failures from the registry", async () => {
  const events = [];
  const graph = {
    emit: (name, detail) => events.push({ name, detail }),
  };
  const runtimes = {
    update: () => {
      throw new Error("runtime update should not be called");
    },
  };
  const loaderRegistry = new ParserRuntimeLoaderRegistry();
  loaderRegistry.register({
    id: "broken",
    match: () => true,
    load: async () => {
      throw new Error("missing runtime module");
    },
  });

  const runtime = await loadConfiguredParserRuntime({
    appState: {
      parsers: [
        {
          id: "broken_parser",
          adapter: "broken",
          runtime: { module: "target/parser.js" },
        },
      ],
    },
    graph,
    parserId: "broken_parser",
    runtimes,
    loaderRegistry,
  });

  assert.equal(runtime, null);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "parser:runtime-load-failed");
  assert.equal(events[0].detail.parserId, "broken_parser");
  assert.equal(events[0].detail.error.message, "missing runtime module");
});

test("fallback highlighter registration keeps plain text last", () => {
  const registry = new FallbackHighlighterRegistry();

  registerFallbackHighlighters(registry);

  assert.equal(registry.highlighterOrder.at(-1).id, "plain");
  assert.equal(registry.detect({ name: "unknown.xyz", suffix: ".xyz" }).id, "plain");
});
