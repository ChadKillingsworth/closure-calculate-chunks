const commonAncestors = require('./common-ancestors');

/**
 * For a given list of nodes, find the lowest node in the graph that exists on every
 * possible path to the entrypoint.
 *
 * @param {string} entrypoint
 * @param {!Array<string>} sourceNodes
 * @param {!Object<string, {distance: number, predecessor: string}>} nodeDistanceFromEntrypoint
 * @param {!Graph} graph
 * @return {string}
 */
module.exports = function lowestCommonAncestor(entrypoint, sourceNodes, graph, nodeDistanceFromEntrypoint) {
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
};
