export class RuntimeRegistry {
  constructor({ graph }) {
    this.graph = graph;
    this.runtimes = new Map();
  }

  register(runtime) {
    this.runtimes.set(runtime.id, runtime);
    this.graph.emit("runtime:registered", { runtime });
    this.graph.emit(`runtime:${runtime.id}:changed`, { runtime });
  }

  update(id, patch) {
    const previous = this.runtimes.get(id) || { id, version: 0 };
    const runtime = {
      ...previous,
      ...patch,
      id,
      version: patch.version ?? previous.version + 1,
    };
    this.runtimes.set(id, runtime);
    this.graph.emit("runtime:changed", { runtime, previous });
    this.graph.emit(`runtime:${id}:changed`, { runtime, previous });
    return runtime;
  }

  get(id) {
    return this.runtimes.get(id);
  }
}

export class CompilerRegistry {
  constructor() {
    this.compilers = new Map();
  }

  register(compiler) {
    this.compilers.set(compiler.id, compiler);
  }

  async compile(id, context) {
    const compiler = this.compilers.get(id);
    if (!compiler) {
      context.workspace.editor.setStatus(`Compiler not registered: ${id}.`);
      return null;
    }
    return compiler.compile(context);
  }
}

export class FallbackHighlighterRegistry {
  constructor() {
    this.highlighters = new Map();
    this.highlighterOrder = [];
  }

  register(highlighter) {
    this.highlighters.set(highlighter.id, highlighter);
    this.highlighterOrder = this.highlighterOrder.filter((existing) => existing.id !== highlighter.id);
    if (highlighter.id === "plain") {
      this.highlighterOrder.push(highlighter);
      return;
    }

    const plainIndex = this.highlighterOrder.findIndex((existing) => existing.id === "plain");
    if (plainIndex === -1) {
      this.highlighterOrder.push(highlighter);
    } else {
      this.highlighterOrder.splice(plainIndex, 0, highlighter);
    }
  }

  get(id) {
    return this.highlighters.get(id) || this.highlighters.get("plain");
  }

  detect(file) {
    for (const highlighter of this.highlighterOrder) {
      if (highlighter.match?.(file)) {
        return highlighter;
      }
    }
    return this.get("plain");
  }
}

export class ModeRegistry {
  constructor({ graph }) {
    this.graph = graph;
    this.modes = new Map();
    this.modeOrder = [];
  }

  register(mode) {
    this.modes.set(mode.id, mode);
    this.modeOrder.push(mode);
  }

  get(id) {
    return this.modes.get(id) || this.modes.get("generic");
  }

  detect(file, workspace) {
    for (const mode of this.modeOrder) {
      if (mode.match?.(file, workspace, this.graph)) {
        return mode;
      }
    }
    return this.get("generic");
  }
}
