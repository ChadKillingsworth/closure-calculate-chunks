class GraphNode {
  #name = undefined;
  #deps = new Set();
  #childChunks = new Set();
  #sources = new Set();

  /**
   * @param {string} name
   * @param {!Set<string>=} deps
   * @param {!Set<string>=} childChunks
   * @param {!Set<string>=} sources
   */
  constructor(name, deps = new Set(), childChunks = new Set(), sources = new Set()) {
    this.#name = name;
    this.#deps = deps;
    this.#childChunks = childChunks;
    this.#sources = sources;
  }

  /** @return {string} */
  get name() {
    return this.#name;
  }

  /** @return {!Set<string>} */
  get deps() {
    return this.#deps;
  }

  /** @return {!Set<string>} */
  get childChunks() {
    return this.#childChunks;
  }

  /** @return {!Set<string>} */
  get sources() {
    return this.#sources;
  }

  /** @return {string} */
  toString() {
    return JSON.stringify({
      name: this.name,
      deps: Array.from(this.deps),
      childChunks: Array.from(this.childChunks),
      sources: Array.from(this.sources)
    });
  }
}

module.exports = GraphNode;
