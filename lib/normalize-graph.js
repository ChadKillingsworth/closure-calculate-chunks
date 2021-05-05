import graphlib from 'graphlib';
import lowestCommonAncestor from './lowest-common-ancestor.js';

/**
 * Build a map of sources to a set of all referencing nodes
 *
 * @param {!graphlib.Graph} graph
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
 * Ensure that every source file is only referenced by a single node.
 * Move any source file referenced by multiple nodes to the lowest common ancestor.
 *
 * @param {string} entrypoint
 * @param {!graphlib.Graph} graph
 * @return {!Map<string, !Array<string>>} sourcesToHoist
 */
export default function normalizeGraph(entrypoint, graph) {
  /** @type {!Object<string, {distance: number, predecessor: (string|undefined)}>} */
  let nodeDistanceFromEntrypoint = graphlib.alg.dijkstra(graph, entrypoint, () => 1);
  const nodesBySource = getNodesReferencingSource(graph);

  // Build a map of sources which are referenced in more than one graph node
  const sourceNodeCombinations = new Map();
  nodesBySource.forEach((referencingNodes, source) => {
    if (referencingNodes.size > 1) {
      addNodeToCombinationMap(source, referencingNodes, sourceNodeCombinations);
    }
  });

  // Ensure that sources are only referenced in a single node.
  // Sources referenced in more than one node are moved up the graph to the lowest common ancestor.
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
        referencingNode.sources.delete(source);
      });
    });
  });

  return sourcesToHoist;
};
