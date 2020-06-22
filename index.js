const fs = require('fs');
const path = require('path');
const parseArgs = require('minimist');
const ChunkGraph = require('./lib/chunk-graph');
const parseGoogDeps = require('./lib/parse-goog-deps');
const resolveFrom = require('./lib/resolve-from');

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
    parent: path.resolve(parts[0]),
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
      parseGoogDeps(depFileContents, googBaseDir).forEach((filepath, namespace) => {
        googPathsByNamespace.set(namespace, filepath);
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

const chunkGraph =
    ChunkGraph.buildFromEntrypoints(entrypoints, manualEntrypoints, rootDir, googBasePath, googPathsByNamespace);
process.stdout.write(JSON.stringify(chunkGraph.getClosureCompilerFlags(), null, 2) + '\n');
