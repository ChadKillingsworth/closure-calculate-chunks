/**
 * Node of a chunk graph. Contains the name, dependencies, referenced child chunks and included source files.
 */
export default class GraphNode {
  #name = undefined;

  /**
   * @param {string} name
   * @param {!Set<string>=} deps
   * @param {!Set<string>=} childChunks
   * @param {!Set<string>=} packageJsonFiles
   */
  constructor(name, deps = new Set(), childChunks = new Set(), packageJsonFiles = new Set()) {
    this.#name = name;
    this.deps = deps;
    this.childChunks = childChunks;
    this.packageJsonFiles = packageJsonFiles;
    this.sources = new Set();
  }

  /** @return {string} */
  get name() {
    return this.#name;
  }

  /** @return {string} */
  toString() {
    return JSON.stringify({
      name: this.name,
      deps: Array.from(this.deps),
      childChunks: Array.from(this.childChunks),
      packageJsonFiles: Array.from(this.packageJsonFiles),
      sources: Array.from(this.sources)
    });
  }
}
