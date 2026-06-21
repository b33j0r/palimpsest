import assert from "node:assert/strict";
import test from "node:test";

import { findConfiguredFiletype, normalizeConfiguredFiletypes } from "../../palimpsest/static/js/configured_filetypes.mjs";
import { parserRuntimeModuleUrl } from "../../palimpsest/static/js/api.mjs";

test("normalizes matching parser ids for filetypes with grammar files", () => {
  const filetypes = normalizeConfiguredFiletypes({
    filetypes: [
      {
        id: "demo",
        extensions: ["*.demo"],
        grammar_files: ["src/demo.pest"],
      },
    ],
  });

  assert.equal(filetypes[0].parser, "demo");
});

test("finds configured filetypes by extension pattern", () => {
  const filetypes = normalizeConfiguredFiletypes({
    filetypes: [
      {
        id: "demo",
        extensions: ["*.demo"],
        parser: "demo_parser",
      },
    ],
  });

  assert.equal(
    findConfiguredFiletype({ name: "sample.demo", suffix: ".demo" }, filetypes).id,
    "demo",
  );
  assert.equal(findConfiguredFiletype({ name: "sample.txt", suffix: ".txt" }, filetypes), null);
});

test("parser runtime URLs are scoped to parser id and module filename", () => {
  const url = parserRuntimeModuleUrl("demo/parser", "/tmp/target/parser.js");

  assert.match(url, /^\/api\/parsers\/demo%2Fparser\/runtime\/parser\.js\?v=/);
});
