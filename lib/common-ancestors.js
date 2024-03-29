import graphlib from 'graphlib';

/**
 * Find all possible paths to the entrypoint from a given starting node.
 *
 * @param {string} startingNode
 * @param {string} entryPoint
 * @param {!graphlib.Graph} graph
 * @param {!Map<string, !Array<!Array<string>>>=} cache
 * @param {!Array<string>=} currentPath
 * @return {!Array<!Array<string>>>}
 */
function pathsToEntrypoint(startingNode, graph, cache = new Map(), currentPath = []) {
  if (cache.has(startingNode)) {
    return cache.get(startingNode);
  }
  const entrypointPaths = [];
  cache.set(startingNode, entrypointPaths);
  const parentNodes = graph.inEdges(startingNode).map((edge) => edge.v);
  if (parentNodes.length === 0) {
    entrypointPaths.push([startingNode]);
  }
  const thisPath = currentPath.concat(startingNode);
  for (let i = 0; i < parentNodes.length; i++) {
    const parentNode = parentNodes[i];
    if (!thisPath.includes(parentNode)) {
      const parentPaths = pathsToEntrypoint(parentNode, graph, cache, thisPath);
      entrypointPaths.push(...parentPaths.map((parentPath) => [startingNode].concat(parentPath)));
    }
  }
  return entrypointPaths;
}

/**
 * For a given list of nodes, find all nodes in the graph that exists on every
 * possible path from each source node to the entrypoint.
 *
 * @param {string} entrypoint
 * @param {!Array<string>} sourceNodes
 * @param {!graphlib.Graph} graph
 * @return {{
 *   commonNodes: !Set<string>,
 *   entrypointPaths: !Array<!Array<string>>
 * }}
 */
export default function commonAncestors(entrypoint, sourceNodes, graph) {
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
};
