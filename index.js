const graphlib = require('graphlib');
const findDepsFromEntryPoints = require('./lib/find-dependencies');
const normalizeGraph = require('./lib/normalize-graph');
const acorn = require('acorn');
const walk = require('acorn-walk');
const fs = require('fs');
const path = require('path');
const resolveFrom = require('./lib/resolve-from');
const parseArgs = require('minimist');

const flags = parseArgs(process.argv.slice(2));

const entrypoints = (Array.isArray(flags.entrypoint) ? flags.entrypoint : [flags.entrypoint])
    .map(entrypoint => path.resolve(entrypoint));
let manualEntrypoints = [];
if (flags.manualEntrypoint) {
  if (Array.isArray(flags.manualEntrypoint)) {
    manualEntrypoints = flags.manualEntrypoint;
  } else {
    manualEntrypoints.push(flags.manualEntrypoint);
  }
}
manualEntrypoints = manualEntrypoints.map(entrypoint => {
  const parts = entrypoint.split(':');
  return {
    parent: parts[0] === '*' ? '*' : path.resolve(parts[0]),
    child: path.resolve(parts[1])
  };
});
const rootDir = flags.root || process.cwd();
const googPathsByNamespace = new Map();
let googBasePath = null;
let googBaseDir = process.cwd();
if (flags.closureLibraryBaseJsPath) {
  googBasePath = resolveFrom(`${process.cwd()}/package.json`, flags.closureLibraryBaseJsPath);
  googBaseDir = path.dirname(googBasePath);
  if (flags.depsFile) {
    const depsFiles = Array.isArray(flags.depsFile) ? flags.depsFile : [flags.depsFile];
    depsFiles.forEach(depFile => {
      const depFilePath = resolveFrom(`${process.cwd()}/package.json`, depFile);
      const depFileContents = fs.readFileSync(depFilePath, 'utf8');
      const ast = acorn.Parser.parse(depFileContents, {ecmaVersion: 2020});
      walk.simple(ast, {
        CallExpression(node) {
          if (node.callee.type === 'MemberExpression' &&
              node.callee.object.type === 'Identifier' &&
              node.callee.object.name === 'goog' &&
              node.callee.property.type === 'Identifier' &&
              node.callee.property.name === 'addDependency') {
            const filePath = path.resolve(googBaseDir, node.arguments[0].value);
            node.arguments[1].elements.forEach((arg) => googPathsByNamespace.set(arg.value, filePath));
          }
        }
      });
    });
  }
  if (flags.extraDeps) {
    const extraDeps = Array.isArray(flags.extraDeps) ? flags.extraDeps : [flags.extraDeps];
    extraDeps.forEach(dep => {
      const [namespace, filepath] = dep.split(':');
      googPathsByNamespace.set(namespace, resolveFrom(`${process.cwd()}/package.json`, filepath));
    });
  }
}

const {graph, entrypoint} =
    findDepsFromEntryPoints(entrypoints, manualEntrypoints, rootDir, googBasePath, googPathsByNamespace);
// console.warn('nodes\n', graphlib.json.write(graph).nodes.map(n => n.value));
// console.warn('edges\n', graphlib.json.write(graph).edges);

normalizeGraph(entrypoint, graph);
// console.warn('Normalized nodes\n', graphlib.json.write(graph).nodes.map(n => n.value));
const chunks = [];
const sources = [];
const sortedNodes = graphlib.alg.isAcyclic(graph) ?
  graphlib.alg.preorder(graph, entrypoint) :
  graphlib.alg.topsort(graph);
const visitedChunks = new Set();
const sortedChunks = [];
sortedNodes.forEach(chunkName => {
  sortedChunks.push(chunkName);
});
let hasError = false;
while(sortedChunks.length > 0) {
  let {length} = sortedChunks;
  for (let i = 0; i < sortedChunks.length; i++) {
    const chunkName = sortedChunks[i];
    const normalizedChunkName = path.relative(process.cwd(), chunkName);
    const chunk = graph.node(chunkName);
    let parents = graph.inEdges(chunkName).map(edge => edge.v);
    const visitedParents = parents.filter(parent => visitedChunks.has(parent));
    if (visitedParents.length !== parents.length) {
      continue;
    }
    parents = parents.map(parentName => path.relative(process.cwd(), parentName));
    if (!chunk.sources.includes(chunkName)) {
      hasError = true;
      console.warn(`Chunk entrypoint ${normalizedChunkName} not found in chunk sources. ` +
          `Ensure that all imports of ${normalizedChunkName} are dynamic.`);
    }
    visitedChunks.add(chunkName);
    chunks.push(`${normalizedChunkName}:${chunk.sources.length}${parents.length === 0 ? '' : ':' + parents.join(',')}`);
    sources.push(...chunk.sources);
    sortedChunks.splice(i, 1);
    break;
  }
  if (length === sortedChunks.length) {
    console.warn('Unable to sort chunks', sortedChunks);
    process.exit(1);
    break;
  }
}
if (hasError) {
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  chunk: chunks,
  sources
}, null, 2) + '\n');
