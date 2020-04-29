const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const path = require('path');
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
 * @return {!{deps: string[], lazyDeps: string[], achoredFiles: !Map<string, string>}}
 */
function findDeps(graph, filepath, ast, baseDirectory, googBasePath = null, googDepsMap = null) {
  const deps = [filepath];
  const lazyDeps = [];
  let usesGoogBase = false;

  const walkVisitors = {
    ImportDeclaration(node, ancestors) {
      deps.push(node.source.value);
    },
    ImportExpression(node, ancestors) {
      if (node.source.type === 'Literal') {
        lazyDeps.push(node.source.value);
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
      if (node.callee.type === 'Identifier' && node.callee.name === 'require' && node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal') {
        deps.push(node.arguments[0].value);
      } else if (node.callee.type === 'MemberExpression' && node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'goog' && node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'require' && node.arguments.length === 1 &&
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
  const filepathDir = path.dirname(filepath);
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
    lazyDeps: lazyDeps.map(dep => resolveFrom(filepath, dep))
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
 * @return {!{deps: string[], lazyDeps: string[]}}
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
      lazyDeps: []
    }
  }
  try {
    const ast = acorn.Parser.parse(fileContents, {
      ecmaVersion: 2020,
      sourceType: 'module'
    });
    const depInfo = findDeps(graph, filepath, ast, baseDirectory, googBasePath, googDepsMap);

    const deps = [];
    const {lazyDeps} = depInfo;

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
      transientDepInfo.lazyDeps.forEach(lazyDep => {
        if (lazyDeps.includes(lazyDep)) {
          return;
        }
        lazyDeps.push(lazyDep);
      });
    }

    return {
      deps,
      lazyDeps
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
    const {deps, lazyDeps} =
        getDependenciesForFile(graph, entrypoint, fileDepsCache, baseDirectory, googBasePath, googDepsMap);
    deps.forEach(dep => {
      currentChunk.sources.add(dep);
    });
    lazyDeps.forEach(chunkEntryPoint => {
      let childChunk = graph.node(chunkEntryPoint);
      if (!childChunk) {
        childChunk = {
          name: chunkEntryPoint,
          sources: new Set([chunkEntryPoint])
        };
        graph.setNode(chunkEntryPoint, childChunk);
        entrypoints.push(chunkEntryPoint);
      }
      graph.setEdge(currentChunk.name, chunkEntryPoint);
    });
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
