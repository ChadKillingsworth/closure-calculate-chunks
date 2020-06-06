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
 * @return {!{deps: !Array<string>, childChunks: !Array<string>}}
 */
function findDeps(
    graph,
    filepath,
    ast,
    baseDirectory,
    googBasePath = null,
    googDepsMap = null) {
  const deps = [filepath];
  const childChunks = [];
  let usesGoogBase = false;

  const walkVisitors = {
    ImportDeclaration(node, ancestors) {
      deps.push(node.source.value);
    },
    ImportExpression(node, ancestors) {
      if (node.source.type !== 'Literal') {
        return;
      }
      childChunks.push(node.source.value);
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
    childChunks: childChunks.map(dep => resolveFrom(filepath, dep)),
  };
}

/**
 * @param {!Graph} graph
 * @param {string} filepath
 * @param {!Map<string, {deps, lazyDeps}>} cache
 * @param {string=} baseDirectory root directory of application
 * @param {string=} googBasePath path to closure library base.js
 * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
 * @param {!Map<string, !Array<string>>} dependenciesToHoist
 * @param {Set<string>=} visitedFiles
 * @return {!{deps: string[], childChunks: string[]}}
 */
function getDependenciesForFile(
    graph,
    filepath,
    cache,
    baseDirectory,
    googBasePath,
    googDepsMap,
    dependenciesToHoist,
    visitedFiles = new Set()
) {
  const deps = [];
  let parsedDeps = [];
  let childChunks = [];
  const cachedDeps = cache.get(filepath);
  if (cachedDeps) {
    parsedDeps = cachedDeps.deps;
    childChunks = cachedDeps.childChunks;
  } else {
    if (!filepath.endsWith('.json')) {
      const fileContents = fs.readFileSync(filepath, 'utf8');
      try {
        const ast = acorn.Parser.parse(fileContents, {
          ecmaVersion: 2020,
          sourceType: 'module'
        });
        const depInfo = findDeps(graph, filepath, ast, baseDirectory, googBasePath, googDepsMap);
        parsedDeps = depInfo.deps.slice();
        childChunks = depInfo.childChunks.slice();
      } catch (e) {
        console.error(filepath, e);
      }
    }
  }

  parsedDeps.push(...(dependenciesToHoist.get(filepath) || []));
  for (let i = 0; i < parsedDeps.length; i++) {
    if (visitedFiles.has(parsedDeps[i])) {
      continue;
    }
    visitedFiles.add(parsedDeps[i]);

    const transientDepInfo = getDependenciesForFile(
        graph, parsedDeps[i], cache, baseDirectory, googBasePath, googDepsMap, dependenciesToHoist, visitedFiles);
    transientDepInfo.deps.unshift(parsedDeps[i]);
    deps.unshift(...transientDepInfo.deps);
    cache.set(parsedDeps[i], transientDepInfo);
    transientDepInfo.childChunks.forEach(childChunkRef => {
      if (childChunks.includes(childChunkRef)) {
        return;
      }
      childChunks.push(childChunkRef);
    });
  }

  return {
    deps,
    childChunks
  };
}

/**
 *
 * @param {!Array<string>} entrypoints paths from which to start building the graph
 * @param {!Array<{parent: string, child: string}>} manualEntrypoints paths from which to start building the graph
 * @param {string=} baseDirectory root directory of application
 * @param {string=} googBasePath path to closure library base.js
 * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
 * @param {!Map<string, !Array<string>>} dependenciesToHoist
 * @return {!{
 *   graph: !Graph,
 *   entrypoint: string
 * }}
 */
function findDepsFromEntryPoints(
    entrypoints,
    manualEntrypoints,
    baseDirectory,
    googBasePath = null,
    googDepsMap = null,
    dependenciesToHoist = new Map()) {
  const graph = new graphlib.Graph({directed: true, compound: false});
  entrypoints = entrypoints.slice();
  let graphEntrypoint = entrypoints[0];

  entrypoints.forEach((entrypoint, index) => {
    graph.setNode(entrypoint, {
      name: entrypoint,
      sources: new Set(),
      childChunks: new Set(),
      deps: new Set()
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
    const {deps, childChunks} = getDependenciesForFile(
        graph, entrypoint, fileDepsCache, baseDirectory, googBasePath, googDepsMap, dependenciesToHoist);
    deps.forEach(dep => {
      currentChunk.sources.add(dep);
      currentChunk.deps.add(dep);
    });
    childChunks.forEach((childChunk) => currentChunk.childChunks.add(childChunk));
    childChunks.forEach(chunkEntryPoint => {
      let chunk = graph.node(chunkEntryPoint);
      if (!chunk) {
        chunk = {
          name: chunkEntryPoint,
          sources: new Set([chunkEntryPoint]),
          childChunks: new Set(),
          deps: new Set()
        };
        graph.setNode(chunkEntryPoint, chunk);
        entrypoints.push(chunkEntryPoint);
      }
      // Make sure the new chunk is not already marked as either a child or parent of the current chunk.
      // In conflicting cases, parent chunk references take precedence over child chunk references.
      if (graph.inEdges(currentChunk.name, chunkEntryPoint).length === 0 &&
          graph.outEdges(currentChunk.name, chunkEntryPoint).length === 0) {
        graph.setEdge(currentChunk.name, chunkEntryPoint);
      }
    });
    const manualEntrypoint = entrypoints.length === 0 && manualEntrypointsToAdd.shift();
    if (manualEntrypoint) {
      const {parent, child} = manualEntrypoint;
      graph.setNode(child, {
        name: child,
        sources: new Set([child]),
        childChunks: new Set(),
        deps: new Set()
      });
      graph.setEdge(parent, child);
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
