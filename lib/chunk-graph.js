const graphlib = require('graphlib');
const path = require('path');
const findDependencies = require('./find-dependencies');
const normalizeGraph = require('./normalize-graph');
const commonAncestors = require('./common-ancestors');

module.exports = class ChunkGraph {
  /** @type {!graphlib.Graph} */
  #graph = undefined;
  /** @type {string} */
  #entrypoint = undefined;

  /**
   * @param {string} entrypoint
   * @param {!graphlib.Graph=} graph
   */
  constructor(entrypoint, graph = new graphlib.Graph({directed: true, compound: false})) {
    this.#graph = graph;
    this.#entrypoint = entrypoint;
  }

  /** @type {string} */
  get entrypoint() {
    return this.#entrypoint;
  }

  /** @return {!graphlib.Graph} */
  get graph() {
    return this.#graph;
  }

  /**
   * Convert the chunk graph to a graph compatible with closure-compiler. Chunks only reference
   * parents which are common to all possible paths to the entrypoint.
   *
   * @return {!graphlib.Graph}
   */
  toClosureGraph() {
    const sourceNodes = new Map();
    this.graph.nodes().forEach((nodeName) => {
      const node = this.graph.node(nodeName);
      node.sources.forEach((source) => {
        sourceNodes.set(source, nodeName);
      });
    });
    const closureGraph = new graphlib.Graph({compound: false, directed: true});
    this.graph.nodes().forEach((nodeName) => {
      const node = this.graph.node(nodeName);
      closureGraph.setNode(nodeName, node);
      const parentNodeNames = this.graph.inEdges(nodeName).map((edge) => edge.v);
      if (parentNodeNames.length === 1) {
        closureGraph.setEdge(parentNodeNames[0], nodeName);
      } else if (parentNodeNames.length > 1) {
        const {entrypointPaths, commonNodes} = commonAncestors(this.entrypoint, parentNodeNames, this.graph);

        const commonParentNodes = new Set();
        entrypointPaths.map((pathToEntrypoint) => pathToEntrypoint.filter((ancestor) => commonNodes.has(ancestor)))
            .forEach((commonNodesPathToEntrypoint) => commonParentNodes.add(commonNodesPathToEntrypoint[0]));

        commonParentNodes.forEach(
            (commonParentNode) => closureGraph.setEdge(commonParentNode, nodeName));
      }
    });

    return closureGraph;
  }

  /**
   * Build the chunk and sources arguments for closure-compiler. Both are lists in dependency order.
   *
   * @return {{sources: !Array<string>, chunk: !Array<string>}}
   */
  getClosureCompilerFlags() {
    const closureGraph = this.toClosureGraph();
    const cycles = graphlib.alg.findCycles(closureGraph);
    if (cycles.length > 0) {
      throw new Error(`Circular references found in chunk graph. \n${JSON.stringify(cycles, null, 2)}`);
    }

    const chunks = [];
    const sources = []
    const visitedChunks = new Set();
    let sortedChunks;
    if (cycles.length === 0) {
      sortedChunks = graphlib.alg.topsort(closureGraph, this.entrypoint);
    } else {
      sortedChunks = closureGraph.nodes();
      const entrypointIndex = sortedChunks.indexOf(entrypoint);
      sortedChunks.splice(entrypointIndex, 1);
      sortedChunks.unshift(entrypoint);
    }
    const errors = [];
    let sourceCount = 0;
    while(sortedChunks.length > 0) {
      let {length} = sortedChunks;
      for (let i = 0; i < sortedChunks.length; i++) {
        const chunkName = sortedChunks[i];
        const normalizedChunkName = path.relative(process.cwd(), chunkName);
        const chunk = closureGraph.node(chunkName);
        let parents = closureGraph.inEdges(chunkName).map(edge => edge.v);
        if (cycles.length === 0) {
          const visitedParents = parents.filter(parent => visitedChunks.has(parent));
          if (visitedParents.length !== parents.length) {
            continue;
          }
        }
        parents = parents.map(parentName => path.relative(process.cwd(), parentName));
        if (!chunk.sources.has(chunkName)) {
          errors.push(`Chunk entrypoint ${normalizedChunkName} not found in chunk sources. ` +
              `Ensure that all imports of ${normalizedChunkName} are dynamic.`);
        }
        sourceCount += chunk.sources.length;
        visitedChunks.add(chunkName);
        const chunkParents = parents.length === 0 ? '' : ':' + parents.join(',');
        chunks.push(`${normalizedChunkName}:${chunk.sources.size}${chunkParents}`);
        sources.push(...chunk.sources);
        sortedChunks.splice(i, 1);
        break;
      }
      if (length === sortedChunks.length) {
        throw new Error(`Unable to sort chunks: ${JSON.stringify(sortedChunks, null, 2)}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`Invalid chunk definitions:\n${errors.join('\n')}`);
    }

    return {
      chunk: chunks,
      sources
    };
  }

  /**
   * Build the chunk graph from a set of entrypoints. The first entrypoint is the primary entrypoint. Additional
   * entrypoints are added as children of the primary entrypoint.
   *
   * @param {!Array<string>} entrypoints paths from which to start building the graph.
   *     The first entry is the primary entrypoint.
   * @param {!Array<{parent: string, child: string}>} manualEntrypoints additional files to be manually added.
   * @param {string=} baseDirectory root directory of application
   * @param {string=} googBasePath path to closure library base.js
   * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
   * @return {!ChunkGraph}
   */
  static buildFromEntrypoints(entrypoints, manualEntrypoints, baseDirectory, googBasePath = null, googDepsMap = null) {
    const fileDepsCache = new Map();
    let graphData = findDependencies(
        entrypoints,
        manualEntrypoints,
        baseDirectory,
        googBasePath,
        googDepsMap,
        new Map(),
        fileDepsCache
    );
    let chunkGraph = new this(graphData.entrypoint, graphData.graph);

    const dependenciesToHoist = normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    let graphNeedsRebuilt = false;
    dependenciesToHoist.forEach((sources) => {
      if (sources.length > 0) {
        graphNeedsRebuilt =  true;
      }
    });
    if (graphNeedsRebuilt) {
      graphData = findDependencies(
          entrypoints,
          manualEntrypoints,
          baseDirectory,
          googBasePath,
          googDepsMap,
          dependenciesToHoist,
          fileDepsCache
      );
      chunkGraph = new this(graphData.entrypoint, graphData.graph);
      normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    }
    return chunkGraph;
  }
};
