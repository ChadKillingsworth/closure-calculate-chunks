#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const parseArgs = require('minimist');
const temp = require('temp');
const open = require('open');
const ChunkGraph = require('./lib/chunk-graph');
const parseGoogDeps = require('./lib/parse-goog-deps');
const resolveFrom = require('./lib/resolve-from');
const generateHtml = require('./lib/generate-html');

const rawFlags = parseArgs(process.argv.slice(2));

if (rawFlags.help) {
  process.stdout.write(`Usage: node --preserve-symlinks node_modules/.bin/closure-calculate-chunks --entrypoint src/main.js

Create a chunk graph from an entrypoint. New chunks are created when a dynamic import statement is encountered.

Options:
  --entrypoint <path/to/file>                           Required: Main entrypoint for the program. The first occurrence
                                                        will be treated as the primary entrypoint. Additional
                                                        entrypoints will be added as children of the primary entrypoint.
  --manual-entrypoint <path/to/Parent>:<path/to/Child>  Optional: Add an arbitrary chunk entrypoint to the graph.
  --root <path/to/project/root>                         Optional: Path to the project root directory. The current
                                                        working directory of the process is used by default.
  --closure-library-base-js-path <path/to/base.js>      Optional: Path to closure-library's base.js file. Required if
                                                        closure-library or goog.module references are used.
  --deps-file <path/to/deps.js>                         Optional: Path to closure-library deps.js file or custom deps.js
                                                        file. Used to find paths to closure-libary namespaces.
  --extra-deps <namespace>:<path/to/file>               Optional: Namespace and path to a file providing a closure
                                                        namespace or module.
  --visualize                                           Create and open an html page to visualize the graph.
  --help                                                Output usage information
`);
  process.exit(0);
}

function convertToCamelCase(value) {
  return value.replace(/[-_][a-z]/g, (match) => match.substr(1).toUpperCase());
}

const flags = {};
Object.keys(rawFlags).forEach((rawFlag) => {
  flags[convertToCamelCase(rawFlag)] = rawFlags[rawFlag];
});

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

if (flags.visualize) {
  generateHtml(chunkGraph)
      .then((html) =>  new Promise((resolve, reject) => {
        const tempFile = temp.path({ prefix: 'closure-calculate-chunks-', suffix: '.html' });

        fs.writeFile(tempFile, html, 'utf8', (err) => {
          if (err) {
            return reject(err);
          }
          resolve(tempFile);
        });
      }))
      .then((tempFilePath) => {
        console.log("Created temp file", tempFilePath);
        const childProcess = open(tempFilePath);
        if (childProcess.stderr) {
          // Catch error output from child process
          childProcess.stderr.once('data', (error) => {
            console.error({ code: 'CannotOpenTempFile', tempFilePath, error });
          });
        }
      });
} else {
  process.stdout.write(JSON.stringify(chunkGraph.getClosureCompilerFlags(), null, 2) + '\n');
}
