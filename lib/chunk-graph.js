import graphlib from 'graphlib';
import path from 'path';
import DepsFinder from './deps-finder.js';
import normalizeGraph from './normalize-graph.js';

export default class ChunkGraph {
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
   * Convert the chunk load order graph to a dependency graph compatible with closure-compiler.
   *
   * @return {!graphlib.Graph}
   */
  toDependencyGraph() {
    const sourceNodes = new Map();
    this.graph.nodes().forEach((nodeName) => {
      const node = this.graph.node(nodeName);
      node.sources.forEach((source) => {
        sourceNodes.set(source, nodeName);
      });
    });
    const dependencyGraph = new graphlib.Graph({compound: false, directed: true});

    /** @type {!Map<string, !Set<string>>} */
    const parentNodes = new Map();
    this.graph.nodes().forEach((nodeName) => {
      /** @type {!GraphNode} */
      const node = this.graph.node(nodeName);
      dependencyGraph.setNode(nodeName, node);
      const parents = new Set();
      if (nodeName !== this.entrypoint) {
        // By definition, every node has a dependency on the entrypoint
        parents.add(this.entrypoint);
      }
      node.deps.forEach((dep) => {
        const containingChunk = sourceNodes.get(dep);
        if (containingChunk !== nodeName) {
          parents.add(containingChunk);
        }
      });
      parentNodes.set(nodeName, parents);
    });

    // Add edges from each node to its parent - but omit parents which are transitively available through
    // other nodes
    //
    // Example: If A depends on both B & C, but B also depends on C, only add edge B -> A.
    dependencyGraph.nodes().forEach((nodeName) => {
      const transitiveParents = new Set();
      parentNodes.get(nodeName).forEach((parentNodeName) => {
        parentNodes.get(parentNodeName).forEach((grandparentNodeName) => {
          transitiveParents.add(grandparentNodeName);
        });
      });
      parentNodes.get(nodeName).forEach((parentNodeName) => {
        if (!transitiveParents.has(parentNodeName)) {
          dependencyGraph.setEdge(parentNodeName, nodeName);
        }
      });
    });

    return dependencyGraph;
  }

  /**
   * Build the chunk and sources arguments for closure-compiler. Both are lists in dependency order.
   *
   * @return {{sources: !Array<string>, chunk: !Array<string>}}
   */
  getClosureCompilerFlags() {
    const closureGraph = this.toDependencyGraph();
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
        /** @type {!GraphNode} */
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
   * @param {!Array<string>} packageJsonEntryNames prefence order of fields to look for in package.json files for the main file
   * @param {!Array<{name:string, files: !Array<string>}>} entrypoints paths from which to start building the graph.
   *     The first entry is the primary entrypoint.
   * @param {!Array<{parent: string, child: {name: string, files: !Array<string>}}>} manualEntrypoints additional files to be manually added.
   * @param {string=} baseDirectory root directory of application
   * @param {string=} googBasePath path to closure library base.js
   * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
   * @return {!ChunkGraph}
   */
  static buildFromEntrypoints(packageJsonEntryNames, entrypoints, manualEntrypoints, baseDirectory, googBasePath, googDepsMap) {
    const depFinder = new DepsFinder(packageJsonEntryNames, baseDirectory, googBasePath, googDepsMap);
    let graphData = depFinder.fromEntryPoints(entrypoints, manualEntrypoints);
    let chunkGraph = new this(graphData.entrypoint, graphData.graph);

    const dependenciesToHoist = normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    let graphNeedsRebuilt = false;
    dependenciesToHoist.forEach((sources) => {
      if (sources.length > 0) {
        graphNeedsRebuilt =  true;
      }
    });
    if (graphNeedsRebuilt) {
      depFinder.addDependenciesToHoist(dependenciesToHoist);
      graphData = depFinder.fromEntryPoints(entrypoints, manualEntrypoints);
      chunkGraph = new this(graphData.entrypoint, graphData.graph);
      normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    }
    return chunkGraph;
  }
}
