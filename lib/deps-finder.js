const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const path = require('path');
const graphlib = require('graphlib');
const GraphNode = require('./graph-node');
const resolve = require('resolve');

/**
 * Return the path of a Closure Library provided namespace
 *
 * @param {string} googNamespace
 * @param {?Map<string, string>} googDepsMap map of closure library provided namespace to filepath
 * @param {string} usedIn filepath of source requiring closure namespace
 * @return {string}
 */
function getGoogDepPath(googNamespace, googDepsMap, usedIn) {
  if (googNamespace === null) {
    throw new Error('Closure Library namespace encountered, but no dependency map provided');
  }
  const googDepPath = googDepsMap.get(googNamespace);
  if (!googDepPath) {
    throw new Error(`Unknown goog dependency ${googNamespace} in ${usedIn}`);
  }
  return googDepPath;
}


class DepsFinder {
  /** @type {!Array<string>|undefined} */
  #packageJsonEntryNames = undefined;
  /** @type {string|undefined} */
  #baseDirectory = undefined;
  /** @type {string|undefined} */
  #googBasePath = undefined;
  /** @type {Map<string, string>|undefined} */
  #googDepsMap = undefined;
  /** @type {!Map<string, !Array<string>>=} */
  #dependenciesToHoist = new Map();
  /** @type {!Map<string, !GraphNode>} */
  #fileDepsCache = new Map();

  /**
   * @param {!Array<string>} packageJsonEntryNames prefence order of fields to look for in package.json files for the main file
   * @param {string=} baseDirectory root directory of application
   * @param {string=} googBasePath path to closure library base.js
   * @param {Map<string, string>=} googDepsMap map of closure library provided namespace to filepath
   */
  constructor(packageJsonEntryNames, baseDirectory, googBasePath, googDepsMap) {
    this.#packageJsonEntryNames = packageJsonEntryNames;
    this.#baseDirectory = baseDirectory;
    this.#googBasePath = googBasePath;
    this.#googDepsMap = googDepsMap;
  }

  /** @param {!Map<string, !Array<string>>} sourcesToHoist */
  addDependenciesToHoist(sourcesToHoist) {
    sourcesToHoist.forEach((sourceList, filepath) => {
      this.#dependenciesToHoist.set(filepath, sourceList);
    });
  }

  packageFilter(packageJson) {
    const normalizedPkg = Object.assign({}, packageJson);
    for (let i = 0; i < this.#packageJsonEntryNames.length; i++) {
      if (packageJson[this.#packageJsonEntryNames[i]]) {
        normalizedPkg.main = packageJson[this.#packageJsonEntryNames[i]];
        return normalizedPkg;
      }
    }
  }

  resolveFrom(filepath, moduleId) {
    const baseDir = path.dirname(moduleId);
    return resolve.sync(filepath, {
      baseDir,
      includeCoreModules: false,
      packageFilter: (pkg) => this.packageFilter(pkg),
      preserveSymlinks: true
    });
  }

  /**
   * Given a filepath and its parsed AST, find all dependencies.
   *
   * Synchronous imports (ES Module import, Common JS require, goog.require and goog.module.get)
   * Are returned as dependencies.
   *
   * ES Dynamic Imports are returned as child chunk dependencies
   *
   * @param {string} filepath
   * @param {!Object} ast
   * @return {!GraphNode}
   */
  findDeps(filepath, ast) {
    const deps = [filepath];
    const childChunks = [];
    let usesGoogBase = false;

    const walkVisitors = {
      ImportDeclaration(node) {
        deps.push(node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type !== 'Literal') {
          return;
        }
        childChunks.push(node.source.value);
      },
      ExportAllDeclaration(node) {
        if (node.source) {
          deps.push(node.source.value);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source) {
          deps.push(node.source.value);
        }
      },
      CallExpression: (node) => {
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
            /^require(Type)?$/.test(node.callee.property.name) &&
            node.arguments.length === 1 &&
            node.arguments[0].type === 'Literal') {
          deps.push(getGoogDepPath(node.arguments[0].value, this.#googDepsMap, filepath));
        }
      },
      MemberExpression(node) {
        if (node.object.type === 'Identifier' && node.object.name === 'goog') {
          usesGoogBase = true;
        }
      }
    };
    walk.simple(ast, walkVisitors);
    if (usesGoogBase && filepath !== this.#googBasePath) {
      deps.unshift(this.#googBasePath);
    }

    const depsPlusPackageJsonFiles = [];
    deps.forEach(dep => {
      if (/^[\.\/]/.test(dep)) {
        depsPlusPackageJsonFiles.push(this.resolveFrom(filepath, dep) || dep);
        return;
      }

      const pathParts = dep.split(/\/|\\/);
      if (pathParts.length === 1) {
        depsPlusPackageJsonFiles.push(this.resolveFrom(`${this.#baseDirectory}/package.json`, `${dep}/package.json`));
      } else if (pathParts.length === 2 && pathParts[0][0] === '@') {
        depsPlusPackageJsonFiles.push(this.resolveFrom( `${this.#baseDirectory}/package.json`, `${dep}/package.json`));
      }
      depsPlusPackageJsonFiles.push(this.resolveFrom(filepath, dep) || dep);
    });

    return new GraphNode(
        filepath,
        new Set(depsPlusPackageJsonFiles),
        new Set(childChunks.map(dep => this.resolveFrom(filepath, dep)))
    );
  }

  /**
   * @param {string} filepath
   * @param {Set<string>=} visitedFiles
   * @return {!GraphNode}
   */
  getDependenciesForFile(filepath, visitedFiles = new Set()) {
    const deps = [];
    let parsedDeps = [];
    let childChunks = [];
    const cachedDeps = this.#fileDepsCache.get(filepath);
    if (cachedDeps) {
      parsedDeps = Array.from(cachedDeps.deps);
      childChunks = Array.from(cachedDeps.childChunks);
    } else {
      if (!filepath.endsWith('.json')) {
        const fileContents = fs.readFileSync(filepath, 'utf8');
        try {
          const ast = acorn.Parser.parse(fileContents, {
            ecmaVersion: 2020,
            sourceType: 'module'
          });
          const depInfo = this.findDeps(filepath, ast);
          parsedDeps = Array.from(depInfo.deps);
          childChunks = Array.from(depInfo.childChunks);
        } catch (e) {
          console.error(filepath, e);
        }
      }
    }

    parsedDeps.push(...(this.#dependenciesToHoist.get(filepath) || []));
    for (let i = 0; i < parsedDeps.length; i++) {
      if (visitedFiles.has(parsedDeps[i])) {
        continue;
      }
      visitedFiles.add(parsedDeps[i]);

      let transientDepInfo = this.getDependenciesForFile(parsedDeps[i], visitedFiles);
      const transientDeps = Array.from(transientDepInfo.deps);
      transientDeps.unshift(parsedDeps[i]);
      transientDepInfo =new GraphNode(
          transientDepInfo.name,
          new Set(transientDeps),
          transientDepInfo.childChunks,
          transientDepInfo.sources
      );
      deps.unshift(...transientDeps);
      this.#fileDepsCache.set(parsedDeps[i], transientDepInfo);
      transientDepInfo.childChunks.forEach(childChunkRef => {
        if (childChunks.includes(childChunkRef)) {
          return;
        }
        childChunks.push(childChunkRef);
      });
    }

    return new GraphNode(filepath, new Set(deps), new Set(childChunks));
  }

  /**
   * @param {!Array<{name:string, files: !Array<string>}>} entrypoints paths from which to start building the graph
   * @param {!Array<{parent: string, child: {name: string, files: !Array<string>}}>} manualEntrypoints paths from which to start building the graph
   * @return {!{
   *   graph: !graphlib.Graph,
   *   entrypoint: string
   * }}
   */
  fromEntryPoints(entrypoints, manualEntrypoints = []) {
    const graph = new graphlib.Graph({directed: true, compound: false});
    entrypoints = entrypoints.slice();
    let graphEntrypoint = entrypoints[0].name;

    entrypoints.forEach((entrypoint, index) => {
      graph.setNode(entrypoint.name, new GraphNode(entrypoint.name));
      if (index === 0) {
        graphEntrypoint = entrypoint.name;
      } else {
        graph.setEdge(graphEntrypoint, entrypoint.name);
      }
    });
    const visitedEntryPoints = new Set();
    const manualEntrypointsToAdd = manualEntrypoints.slice();
    while (entrypoints.length > 0) {
      const entrypoint = entrypoints.shift();
      if (visitedEntryPoints.has(entrypoint.name)) {
        continue;
      }
      visitedEntryPoints.add(entrypoint.name);
      const currentChunk = graph.node(entrypoint.name);
      for (let i = 0; i < entrypoint.files.length; i++) {
        const {deps, childChunks} = this.getDependenciesForFile(entrypoint.files[i]);
        deps.forEach(dep => {
          currentChunk.sources.add(dep);
          currentChunk.deps.add(dep);
        });
        childChunks.forEach((childChunk) => currentChunk.childChunks.add(childChunk));
        childChunks.forEach(chunkEntryPoint => {
          let chunk = graph.node(chunkEntryPoint);
          if (!chunk) {
            chunk = new GraphNode(chunkEntryPoint, new Set(), new Set(), new Set([chunkEntryPoint]));
            graph.setNode(chunkEntryPoint, chunk);
            entrypoints.push({
              name: chunkEntryPoint,
              files: [chunkEntryPoint]
            });
          }
          // Make sure the new chunk is not already marked as either a child or parent of the current chunk.
          // In conflicting cases, parent chunk references take precedence over child chunk references.
          if (graph.inEdges(currentChunk.name, chunkEntryPoint).length === 0 &&
              graph.outEdges(currentChunk.name, chunkEntryPoint).length === 0) {
            graph.setEdge(currentChunk.name, chunkEntryPoint);
          }
        });
      }
      const manualEntrypoint = entrypoints.length === 0 && manualEntrypointsToAdd.shift();
      if (manualEntrypoint) {
        const {parent, child} = manualEntrypoint;
        graph.setNode(child.name, new GraphNode(child.name, new Set(), new Set(), new Set(child.files)));
        graph.setEdge(parent, child.name);
        entrypoints.push(child);
      }
    }
    graph.nodes().forEach(nodeName => {
      const node = graph.node(nodeName);
      if (!node) {
        console.warn(nodeName);
      }
      node.sources = new Set(Array.from(node.sources).reverse());
    });
    return {
      graph,
      entrypoint: graphEntrypoint
    };
  }
}

module.exports = DepsFinder;