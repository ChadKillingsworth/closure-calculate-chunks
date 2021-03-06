import graphlib from 'graphlib';
import path from 'path';
import DepsFinder from './deps-finder.js';
import normalizeGraph from './normalize-graph.js';
import fs from 'fs/promises';
import {NAMING_STYLE, outputChunkNaming} from './chunk-naming.js';

/**
 * A graph of output chunks built from an entrypoint. Separate chunks are split off
 * from async import statements.
 */
export default class ChunkGraph {
  /** @type {!graphlib.Graph} */
  #graph = undefined;
  /** @type {string} */
  #entrypoint = undefined;
  /** @type {!Map<string, !Set<string>>} */
  #sourceReferences = new Map();
  /** @type {!{readFile:(function(string,string):!Promise<string>)}} */
  static fsAdapter = {
    readFile(filepath, encoding) {
      return fs.readFile(filepath, encoding);
    }
  };

  /**
   * @param {string} entrypoint
   * @param {!graphlib.Graph=} graph
   * @param {!Map<string, !Set<string>>=} sourceReferences
   */
  constructor(entrypoint, graph = new graphlib.Graph({directed: true, compound: false}), sourceReferences = new Map()) {
    this.#graph = graph;
    this.#entrypoint = entrypoint;
    this.#sourceReferences = sourceReferences;
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
   * @param {string=} namePrefix
   * @param {!NAMING_STYLE=} namingStyle
   * @return {{sources: !Array<string>, chunk: !Array<string>}}
   */
  getClosureCompilerFlags(namePrefix = '', namingStyle = NAMING_STYLE.ENTRYPOINT) {
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
      const entrypointIndex = sortedChunks.indexOf(this.entrypoint);
      sortedChunks.splice(entrypointIndex, 1);
      sortedChunks.unshift(this.entrypoint);
    }
    const errors = [];
    let sourceCount = 0;
    const getOutputChunkName = outputChunkNaming(this.entrypoint, namePrefix, namingStyle);
    while(sortedChunks.length > 0) {
      let {length} = sortedChunks;
      for (let i = 0; i < sortedChunks.length; i++) {
        const chunkName = sortedChunks[i];
        /** @type {!GraphNode} */
        const chunk = closureGraph.node(chunkName);
        const parents = closureGraph.inEdges(chunkName).map(edge => edge.v);
        if (cycles.length === 0) {
          const visitedParents = parents.filter(parent => visitedChunks.has(parent));
          if (visitedParents.length !== parents.length) {
            continue;
          }
        }
        if (!chunk.sources.has(chunkName)) {
          const relativePathName = path.relative(process.cwd(), chunkName);
          const referencingChunks = Array.from(this.#sourceReferences.get(chunkName) || []);
          errors.push(`Chunk entrypoint ${relativePathName} not found in chunk sources. ` +
              `Ensure that all imports of ${relativePathName} are dynamic. ` +
              `Referenced in: ${JSON.stringify(referencingChunks, null, 2)}`);
        }
        sourceCount += chunk.sources.length;
        visitedChunks.add(chunkName);
        const chunkDefParts = [getOutputChunkName(chunkName), chunk.sources.size];
        if (parents.length > 0) {
          chunkDefParts.push(parents.map(getOutputChunkName).join(','));
        }
        chunks.push(chunkDefParts.join(':'));
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
      js: sources
    };
  }

  /**
   * Build the chunk graph from a set of entrypoints. The first entrypoint is the primary entrypoint. Additional
   * entrypoints are added as children of the primary entrypoint.
   *
   * @param {!Array<{name:string, files: !Array<string>}>} entrypoints paths from which to start building the graph.
   *     The first entry is the primary entrypoint.
   * @param {!Array<{parent: string, child: {name: string, files: !Array<string>}}>=} manualEntrypoints additional files to be manually added.
   * @param {!Array<string>=} packageJsonEntryNames prefence order of fields to look for in package.json files for the main file
   * @param {string=} baseDirectory root directory of application
   * @param {string=} googBasePath path to closure library base.js
   * @param {!Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
   * @return {!ChunkGraph}
   */
  static async buildFromEntrypoints(
      entrypoints,
      manualEntrypoints = [],
      packageJsonEntryNames = ['browser', 'module', 'main'],
      baseDirectory = process.cwd(),
      googBasePath = process.cwd(),
      googDepsMap = new Map()) {
    const depFinder = new DepsFinder(packageJsonEntryNames, baseDirectory, googBasePath, googDepsMap, this.fsAdapter);
    let graphData = await depFinder.fromEntryPoints(entrypoints, manualEntrypoints);
    const sourceReferences = new Map();
    depFinder.fileDependencies.forEach((node, filename) => {
      node.deps.forEach((dep) => {
        let references = sourceReferences.get(dep);
        if (!references) {
          references = new Set();
          sourceReferences.set(dep, references);
        }
        references.add(filename);
      });
    });
    let chunkGraph = new this(graphData.entrypoint, graphData.graph, sourceReferences);
    const dependenciesToHoist = normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    let graphNeedsRebuilt = false;
    dependenciesToHoist.forEach((sources) => {
      if (sources.length > 0) {
        graphNeedsRebuilt =  true;
      }
    });
    if (graphNeedsRebuilt) {
      depFinder.addDependenciesToHoist(dependenciesToHoist);
      graphData = await depFinder.fromEntryPoints(entrypoints, manualEntrypoints);
      chunkGraph = new this(graphData.entrypoint, graphData.graph, sourceReferences);
      normalizeGraph(chunkGraph.entrypoint, chunkGraph.graph);
    }
    return chunkGraph;
  }
}
