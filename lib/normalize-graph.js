const graphlib = require('graphlib');
const {Graph} = graphlib;

/**
 * Ensure that every node has a path upward to the entrypoint.
 *
 * @param {string} entrypoint
 * @param {!Graph} graph
 */
function ensurePathToEntrypointFromAllNodes(entrypoint, graph) {
  graph.nodes().forEach(nodeName => {
    if (nodeName === entrypoint) {
      return;
    }
    if (graph.inEdges(nodeName).length === 0) {
      graph.setEdge(entrypoint, nodeName);
    }
  });
}

/**
 * Build a map of sources to a set of all referencing nodes
 *
 * @param {!Graph} graph
 * @return {!Map<string, !Set<string>>}
 */
function getNodesReferencingSource(graph) {
  const nodesBySource = new Map();
  graph.nodes().forEach(nodeName => {
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
 * For a given node, find all possible paths to the entrypoint
 *
 * @param {string} startingNode
 * @param {!Graph} graph
 * @param {!Array<string>=} precedingPathNodes
 * @return {!Array<!Array<string>>}
 */
function getPathsToEntrypoint(startingNode, graph, precedingPathNodes= []) {
  if (precedingPathNodes.includes(startingNode)) {
    return precedingPathNodes;
  }
  const pathNodes = precedingPathNodes.concat([startingNode]);

  const parentNodes = graph.inEdges(startingNode).map(edge => edge.v);
  if (parentNodes.length === 0) {
    return [pathNodes];
  }

  const pathsToEntrypoint = [];
  parentNodes.forEach(parentNode => {
    pathsToEntrypoint.push(...getPathsToEntrypoint(parentNode, graph, pathNodes));
  });
  return pathsToEntrypoint;
}

/**
 * For a given list of nodes, find the lowest node in the graph that exists on every
 * possible paths to the entrypoint.
 *
 * @param {!Array<string>} sourceNodes
 * @param {!Map<string, {distance: number}>} nodeDistanceFromEntrypoint
 * @param {!Graph} graph
 * @return {string}
 */
function lowestCommonAncestor(sourceNodes, graph, nodeDistanceFromEntrypoint) {
  /** @type {!Array<!Set<string>>} */
  const allPaths = [];
  sourceNodes.forEach(sourceNode => {
    allPaths.push(...getPathsToEntrypoint(sourceNode, graph).map(nodeList => new Set(nodeList)));
  });

  const firstPath = allPaths[0];
  const remainingPaths = allPaths.slice(1);
  /** @type {!Array<string>} */
  const validNodes = [];
  firstPath.forEach(node => {
    if (remainingPaths.every(otherNodeSet => otherNodeSet.has(node))) {
      validNodes.push(node);
    };
  });


  const orderedCommonAncestors = validNodes
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
 * @return {!Graph}
 */
function normalizeGraph(entrypoint, graph) {
  ensurePathToEntrypointFromAllNodes(entrypoint, graph);

  const nodesBySource = getNodesReferencingSource(graph);
  const sourceNodeCombinations = new Map();

  // Reduce the set of sources to those referenced in more than one node
  nodesBySource.forEach((referencingNodes, source) => {
    if (referencingNodes.size > 1) {
      addNodeToCombinationMap(source, referencingNodes, sourceNodeCombinations);
    }
  });

  if (sourceNodeCombinations.size === 0) {
    return graph;
  }

  /** @type {!Object<string, {distance: number, predecessor: (string|undefined)}>} */
  const nodeDistanceFromEntrypoint = graphlib.alg.dijkstra(graph, entrypoint, () => 1);
  sourceNodeCombinations.forEach(sourceInfo=> {
    const lca = lowestCommonAncestor(Array.from(sourceInfo.nodes), graph, nodeDistanceFromEntrypoint);
    sourceInfo.sourceSet.forEach(source => {
      if (!graph.node(lca).sources.includes(source)) {
        // console.warn('Moving', Array.from(sourceInfo.sourceSet), 'from', Array.from(sourceInfo.nodes), 'to', lca);
        graph.node(lca).sources.push(source);
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
}

module.exports = normalizeGraph;
