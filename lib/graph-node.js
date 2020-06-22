class GraphNode {
  /**
   * @param {string} name
   * @param {!Set<string>=} deps
   * @param {!Set<string>=} childChunks
   * @param {!Set<string>=} sources
   */
  constructor(name, deps = new Set(), childChunks = new Set(), sources = new Set()) {
    this.name_ = name;
    this.deps_ = deps;
    this.childChunks_ = childChunks;
    this.sources_ = sources;
  }

  /** @return {string} */
  get name() {
    return this.name_;
  }

  /** @return {!Set<string>} */
  get deps() {
    return this.deps_;
  }

  /** @return {!Set<string>} */
  get childChunks() {
    return this.childChunks_;
  }

  /** @return {!Set<string>} */
  get sources() {
    return this.sources_;
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
