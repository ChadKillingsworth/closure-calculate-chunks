const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const graphlib = require('graphlib');
const resolveFrom = require('./resolve-from');

/**
 * @typedef {{
 *   name: string,
 *   sources: !Array<string>
 * }}
 */
let GraphNode;

/**
 * Return the path of a Closure Library provided namespace
 *
 * @param {string} googNamespace
 * @param {?Map<string, string>} googDepsMap map of closure library provided namespace to filepath
 * @param {string} usedIn filepath of source requiring closure namespace
 * @return {string}
 */
function getGoogDepPath(googNamespace, googDepsMap, usedIn) {
  if (getGoogDepPath === null) {
    throw new Error('Closure Library namespace encountered, but no dependency map provided');
  }
  const googDepPath = googDepsMap.get(googNamespace);
  if (!googDepPath) {
    throw new Error(`Unknown goog dependency ${googNamespace} in ${usedIn}`);
  }
  return googDepPath;
}

function ensureValueExists(map, key) {
  let value = map.get(key);
  if (!value) {
    value = [];
    map.set(key, value);
  }
  return value;
}

/**
 * Given a filepath and its parsed AST, find all dependencies.
 *
 * Synchronous imports (ES Module import, Common JS require, goog.require and goog.module.get)
 * Are returned as dependencies.
 *
 * ES Dynamic Imports are returned as lazy dependencies
 *
 * @param {!Graph} graph
 * @param {string} filepath
 * @param {!Object} ast
 * @param {string} baseDirectory
 * @param {?string} googBasePath path to closure library base.js
 * @param {?Map<string, string>} googDepsMap map of closure library provided namespace to filepath
 * @return {!{deps: string[], childChunkRefs: string[], parentChunkRefs: string[]}}
 */
function findDeps(graph, filepath, ast, baseDirectory, googBasePath = null, googDepsMap = null) {
  const deps = [filepath];
  const childChunkRefs = [];
  const parentChunkRefs =[];
  let usesGoogBase = false;

  const walkVisitors = {
    ImportDeclaration(node, ancestors) {
      deps.push(node.source.value);
    },
    ImportExpression(node, ancestors) {
      if (node.source.type !== 'Literal') {
        return;
      }
      const grandparentExpression = ancestors[ancestors.length - 3];

      // Is this import('foo').then(foo => {}) ?
      // If so, does the .then callback have an argument?
      // Arguments to a .then callback indicate a parent chunk reference
      if (grandparentExpression &&
          grandparentExpression.type === 'CallExpression' &&
          grandparentExpression.callee.type === 'MemberExpression' &&
          grandparentExpression.callee.object === node &&
          grandparentExpression.callee.property.type === 'Identifier' &&
          grandparentExpression.callee.property.name === 'then' &&
          grandparentExpression.arguments.length > 0 &&
          /^(Arrow)FunctionExpression$/.test(grandparentExpression.arguments[0].type) &&
          grandparentExpression.arguments[0].params.length > 0) {
        parentChunkRefs.push(node.source.value);
      } else {
        childChunkRefs.push(node.source.value);
      }
    },
    ExportAllDeclaration(node, ancestors) {
      if (node.source) {
        deps.push(node.source.value);
      }
    },
    ExportNamedDeclaration(node, ancestors) {
      if (node.source) {
        deps.push(node.source.value);
      }
    },
    CallExpression(node, ancestors) {
      // require('module')
      if (node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal') {
        deps.push(node.arguments[0].value);
      // goog.require('namespace')
      } else if (node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'goog' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal') {
        deps.push(getGoogDepPath(node.arguments[0].value, googDepsMap, filepath));
      }
    },
    MemberExpression(node, ancestors) {
      if (node.object.type === 'Identifier' && node.object.name === 'goog') {
        usesGoogBase = true;
      }
    }
  };
  walk.ancestor(ast, walkVisitors);
  if (usesGoogBase && filepath !== googBasePath) {
    deps.unshift(googBasePath);
  }
  function addPackageJsonFiles(deps) {
    const depsPlusPackageJsonFiles = [];
    deps.forEach(dep => {
      if (/^\.|\//.test(dep)) {
        depsPlusPackageJsonFiles.push(resolveFrom(filepath, dep) || dep);
        return;
      }

      const pathParts = dep.split(/\/|\\/);
      if (pathParts.length === 1) {
        depsPlusPackageJsonFiles.push(resolveFrom(`${baseDirectory}/package.json`, `${dep}/package.json`));
      } else if (pathParts.length === 2 && pathParts[0][0] === '@') {
        depsPlusPackageJsonFiles.push(resolveFrom(`${baseDirectory}/package.json`, `${dep}/package.json`));
      }
      depsPlusPackageJsonFiles.push(resolveFrom(filepath, dep) || dep);
    });
    return depsPlusPackageJsonFiles;
  }

  return {
    deps: addPackageJsonFiles(deps),
    childChunkRefs: childChunkRefs.map(dep => resolveFrom(filepath, dep)),
    parentChunkRefs: parentChunkRefs.map(dep => resolveFrom(filepath, dep))
  };
}

/**
 * @param {!Graph} graph
 * @param {string} filepath
 * @param {!Map<string, {deps, lazyDeps}>} cache
 * @param {string=} baseDirectory root directory of application
 * @param {string=} googBasePath path to closure library base.js
 * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
 * @param {Set<string>=} visitedFiles
 * @return {!{deps: string[], childChunkRefs: string[], parentChunkRefs: string[]}}
 */
function getDependenciesForFile(
    graph,
    filepath,
    cache,
    baseDirectory,
    googBasePath,
    googDepsMap,
    visitedFiles = new Set()
) {
  if (cache.get(filepath)) {
    return cache.get(filepath);
  }
  const fileContents = fs.readFileSync(filepath, 'utf8');
  if (filepath.endsWith('.json')) {
    return {
      deps: [],
      childChunkRefs: [],
      parentChunkRefs: []
    }
  }
  try {
    const ast = acorn.Parser.parse(fileContents, {
      ecmaVersion: 2020,
      sourceType: 'module'
    });
    const depInfo = findDeps(graph, filepath, ast, baseDirectory, googBasePath, googDepsMap);

    const deps = [];
    const childChunkRefs = depInfo.childChunkRefs.slice();
    const parentChunkRefs = depInfo.parentChunkRefs.slice();

    for (let i = 0; i < depInfo.deps.length; i++) {
      if (visitedFiles.has(depInfo.deps[i])) {
        continue;
      }
      visitedFiles.add(depInfo.deps[i]);
      const transientDepInfo =
          getDependenciesForFile(graph, depInfo.deps[i], cache, baseDirectory, googBasePath, googDepsMap, visitedFiles);
      transientDepInfo.deps.unshift(depInfo.deps[i]);
      deps.unshift(...transientDepInfo.deps);
      cache.set(depInfo.deps[i], transientDepInfo);
      transientDepInfo.childChunkRefs.forEach(childChunkRef => {
        if (childChunkRefs.includes(childChunkRef)) {
          return;
        }
        childChunkRefs.push(childChunkRef);
      });
      transientDepInfo.parentChunkRefs.forEach(parentChunkRef => {
        if (parentChunkRefs.includes(parentChunkRef)) {
          return;
        }
        parentChunkRefs.push(parentChunkRef);
      });
    }

    return {
      deps,
      childChunkRefs,
      parentChunkRefs
    };
  } catch (e) {
    console.error(filepath, e);
  }
}

/**
 *
 * @param {!Array<string>} entrypoints paths from which to start building the graph
 * @param {!Array<{parent: string, child: string}>} manualEntrypoints paths from which to start building the graph
 * @param {string=} baseDirectory root directory of application
 * @param {string=} googBasePath path to closure library base.js
 * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
 * @return {!{
 *   graph: !Graph,
 *   entrypoint: string
 * }}
 */
function findDepsFromEntryPoints(entrypoints, manualEntrypoints, baseDirectory, googBasePath = null, googDepsMap = null) {
  const graph = new graphlib.Graph({directed: true, compound: false});
  let graphEntrypoint = entrypoints[0];

  entrypoints.forEach((entrypoint, index) => {
    graph.setNode(entrypoint, {
      name: entrypoint,
      sources: new Set([])
    });
    if (index === 0) {
      graphEntrypoint = entrypoint;
    } else {
      graph.setEdge(graphEntrypoint, entrypoint);
    }
  });
  const fileDepsCache = new Map();
  const visitedEntryPoints = new Set();
  const manualEntrypointsToAdd = manualEntrypoints.slice();
  while (entrypoints.length > 0) {
    const entrypoint = entrypoints.shift();
    if (visitedEntryPoints.has(entrypoint)) {
      continue;
    }
    visitedEntryPoints.add(entrypoint);
    const currentChunk = graph.node(entrypoint);
    const {deps, childChunkRefs, parentChunkRefs} =
        getDependenciesForFile(graph, entrypoint, fileDepsCache, baseDirectory, googBasePath, googDepsMap);
    deps.forEach(dep => {
      currentChunk.sources.add(dep);
    });
    for (let i = 0; i < 2; i++) {
      let isChildChunkRef = i === 0;
      let chunkRefs = isChildChunkRef ? childChunkRefs : parentChunkRefs;
      chunkRefs.forEach(chunkEntryPoint => {
        let chunk = graph.node(chunkEntryPoint);
        if (!chunk) {
          chunk = {
            name: chunkEntryPoint,
            sources: new Set([chunkEntryPoint])
          };
          graph.setNode(chunkEntryPoint, chunk);
          entrypoints.push(chunkEntryPoint);
        }
        if (isChildChunkRef) {
          // Make sure the new chunk is not already marked as either a child or parent of the current chunk.
          // In conflicting cases, parent chunk references take precedence over child chunk references.
          if (graph.inEdges(currentChunk.name, chunkEntryPoint).length === 0 &&
              graph.outEdges(currentChunk.name, chunkEntryPoint).length === 0) {
            graph.setEdge(currentChunk.name, chunkEntryPoint);
          }
        } else {
          // If the new chunk is currently marked as a child, remove that reference
          if (graph.outEdges(currentChunk.name, chunkEntryPoint).length > 0) {
            graph.removeEdge(currentChunk.name, chunkEntryPoint);
          }
          if (graph.inEdges(currentChunk.name, chunkEntryPoint).length === 0) {
            graph.setEdge(chunkEntryPoint, currentChunk.name);
          }
        }
      });
    }
    const manualEntrypoint = entrypoints.length === 0 && manualEntrypointsToAdd.shift();
    if (manualEntrypoint) {
      const {parent, child} = manualEntrypoint;
      graph.setNode(child, {
        name: child,
        sources: new Set([child])
      });
      if (parent === '*') {
        graph.nodes().forEach(nodePath => {
          graph.setEdge(nodePath, child);
        });
      } else {
        graph.setEdge(parent, child);
      }
      entrypoints.push(child);
    }
  }
  graph.nodes().forEach(nodeName => {
    const node = graph.node(nodeName);
    if (!node) {
      console.warn(nodeName);
    }
    node.sources = Array.from(node.sources).reverse();
  });
  return {
    graph,
    entrypoint: graphEntrypoint
  };
}

module.exports = findDepsFromEntryPoints;
