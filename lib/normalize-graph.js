const graphlib = require('graphlib');
const {Graph} = graphlib;

/**
 * Build a map of sources to a set of all referencing nodes
 *
 * @param {!Graph} graph
 * @return {!Map<string, !Set<string>>}
 */
function getNodesReferencingSource(graph) {
  const nodesBySource = new Map();
  graph.nodes().forEach(nodeName => { if (!graph.node(nodeName)) debugger;
    graph.node(nodeName).sources.forEach(source => {
      let referencingNodes = nodesBySource.get(source);
      if (!referencingNodes) {
        referencingNodes = new Set();
        nodesBySource.set(source, referencingNodes);
      }
      referencingNodes.add(nodeName);
    });
  });
  return nodesBySource;
}

/**
 * @param {string} source path of JS file referenced from a node
 * @param {!Set<string>} nodes
 * @param {!Map<string, {sourceSet: Set<string>, nodes: !Set<string>}>} nodeCombinations
 */
function addNodeToCombinationMap(source, nodes, nodeCombinations) {
  const key = Array.from(nodes).sort().join(' ');
  let sourceSetInfo = nodeCombinations.get(key);
  if (!sourceSetInfo) {
    sourceSetInfo = {
      sourceSet: new Set(),
      nodes
    };
    nodeCombinations.set(key, sourceSetInfo);
  }
  sourceSetInfo.sourceSet.add(source);
}

/**
 * @param {string} startingNode
 * @param {string} entryPoint
 * @param {!Graph} graph
 * @param {!Map<string, !Array<!Array<string>>>=} cache
 * @return {!Array<!Array<string>>>}
 */
function pathsToEntrypoint(startingNode, graph, cache = new Map()) {
  if (cache.has(startingNode)) {
    return cache.get(startingNode);
  }
  const entrypointPaths = [];
  cache.set(startingNode, entrypointPaths);
  const parentNodes = graph.inEdges(startingNode).map((edge) => edge.v);
  if (parentNodes.length === 0) {
    entrypointPaths.push([startingNode]);
  }
  for (let i = 0; i < parentNodes.length; i++) {
    const parentNode = parentNodes[i];
    const parentPaths = pathsToEntrypoint(parentNode, graph, cache);
    entrypointPaths.push(...parentPaths.map((parentPath) => [startingNode].concat(parentPath)));
  }
  return entrypointPaths;
}


/**
 * For a given list of nodes, find the lowest node in the graph that exists on every
 * possible paths to the entrypoint.
 *
 * @param {string} entrypoint
 * @param {!Array<string>} sourceNodes
 * @param {!Object<string, {distance: number, predecessor: string}>} nodeDistanceFromEntrypoint
 * @param {!Graph} graph
 * @return {string}
 */
function lowestCommonAncestor(entrypoint, sourceNodes, graph, nodeDistanceFromEntrypoint) {
  const pathsCache = new Map();
  /** @type {!Set<string>} */
  let validNodes;
  for (let i = 0; i < sourceNodes.length; i++) {
    const entrypointPaths = pathsToEntrypoint(sourceNodes[i], graph, pathsCache);
    let j = 0;
    if (!validNodes) {
      validNodes = new Set(entrypointPaths[0]);
      j = 1;
    }
    for (; j < entrypointPaths.length; j++) {
      const nodesToDelete = new Set();
      validNodes.forEach((validNode) => {
        if (!entrypointPaths[j].includes(validNode)) {
          nodesToDelete.add(validNode);
        }
      });
      nodesToDelete.forEach((nodesToDelete) => validNodes.delete(nodesToDelete));
    }
  }

  const orderedCommonAncestors = Array.from(validNodes)
      .sort((a, b) => {
        if (nodeDistanceFromEntrypoint[a].distance === nodeDistanceFromEntrypoint[b].distance) {
          return a.localeCompare(b);
        }
        return nodeDistanceFromEntrypoint[b].distance - nodeDistanceFromEntrypoint[a].distance;
      });
  return orderedCommonAncestors[0];
}

/**
 * Ensure that every source file is only referenced by a single node.
 * Move any source file referenced by multiple nodes to the lowest common ancestor.
 *
 * @param {string} entrypoint
 * @param {!Graph} graph
 * @return {!Map<string, !Array<string>>} sourcesToHoist
 */
function normalizeGraph(entrypoint, graph) {
  /** @type {!Object<string, {distance: number, predecessor: (string|undefined)}>} */
  let nodeDistanceFromEntrypoint = graphlib.alg.dijkstra(graph, entrypoint, () => 1);
  const nodesBySource = getNodesReferencingSource(graph);

  // Reduce the set of sources to those referenced in more than one node
  const sourceNodeCombinations = new Map();
  nodesBySource.forEach((referencingNodes, source) => {
    if (referencingNodes.size > 1) {
      addNodeToCombinationMap(source, referencingNodes, sourceNodeCombinations);
    }
  });

  const sourcesToHoist = new Map();
  sourceNodeCombinations.forEach(sourceInfo=> {
    const lca = lowestCommonAncestor(entrypoint, Array.from(sourceInfo.nodes), graph, nodeDistanceFromEntrypoint);
    sourceInfo.sourceSet.forEach(source => {
      let existingSourcesToHoistForLCA = sourcesToHoist.get(lca);
      if (!existingSourcesToHoistForLCA) {
        existingSourcesToHoistForLCA = [];
        sourcesToHoist.set(lca, existingSourcesToHoistForLCA);
      }
      if (!existingSourcesToHoistForLCA.includes(source)) {
        existingSourcesToHoistForLCA.push(source);
      }
      sourceInfo.nodes.forEach(referencingNodeName => {
        if (referencingNodeName === lca) {
          return;
        }
        const referencingNode = graph.node(referencingNodeName);
        referencingNode.sources = referencingNode.sources.filter(refNodeSource => refNodeSource !== source);
      });
    });
  });

  return sourcesToHoist;
}

module.exports = normalizeGraph;
