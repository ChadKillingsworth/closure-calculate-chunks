const graphlib = require('graphlib');
const {Graph} = graphlib;

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
 * @param {!Graph} graph
 * @return {{
 *   commonNodes: !Set<string>,
 *   entrypointPaths: !Array<!Array<string>>
 * }}
 */
function commonAncestors(entrypoint, sourceNodes, graph) {
  const pathsCache = new Map();
  /** @type {!Set<string>} */
  let commonNodes;
  /** @type {!Array<!Array<string>>} */
  const entrypointPaths = [];

  // Since this is a recursive function, avoid using looping methods which involve function callbacks
  // to avoid reaching call stack limits.
  for (let i = 0; i < sourceNodes.length; i++) {
    // Get all paths from this node to the entrypoint.
    const entrypointPathsForNode = pathsToEntrypoint(sourceNodes[i], graph, pathsCache);
    entrypointPaths.push(...entrypointPathsForNode);

    // If this is the first possible path, all nodes are common
    let j = 0;
    if (!commonNodes) {
      commonNodes = new Set(entrypointPathsForNode[0]);
      j = 1;
    }

    // For each path, reduce the set of valid nodes to those that are part of that path.
    for (; j < entrypointPathsForNode.length; j++) {
      const nodesToDelete = new Set();
      commonNodes.forEach((validNode) => {
        if (!entrypointPathsForNode[j].includes(validNode)) {
          nodesToDelete.add(validNode);
        }
      });
      nodesToDelete.forEach((nodesToDelete) => commonNodes.delete(nodesToDelete));
    }
  }
  return {
    commonNodes,
    entrypointPaths
  };
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
  const {commonNodes} = commonAncestors(entrypoint, sourceNodes, graph);

  // Sort the valid nodes by their distance from the entrypoint and return the highest distance as
  // that's the lowest valid node in the graph.
  const orderedCommonAncestors = Array.from(commonNodes)
      .sort((a, b) => {
        if (nodeDistanceFromEntrypoint[a].distance === nodeDistanceFromEntrypoint[b].distance) {
          return a.localeCompare(b);
        }
        return nodeDistanceFromEntrypoint[b].distance - nodeDistanceFromEntrypoint[a].distance;
      });
  return orderedCommonAncestors[0];
}

module.exports = {
  commonAncestors,
  lowestCommonAncestor
};
