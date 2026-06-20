export class SignalGraph {
  constructor() {
    this.listeners = new Map();
    this.state = new Map();
  }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
    return () => listeners.delete(listener);
  }

  emit(type, detail = {}) {
    const event = { type, detail };
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
    for (const listener of this.listeners.get("*") || []) {
      listener(event);
    }
  }

  set(key, value) {
    const previous = this.state.get(key);
    this.state.set(key, value);
    this.emit(`${key}:changed`, { key, value, previous });
  }

  get(key) {
    return this.state.get(key);
  }
}
