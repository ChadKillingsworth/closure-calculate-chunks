#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import temp from 'temp';
import open from 'open';
import yargs from 'yargs';
import Module from 'module';
import ChunkGraph from './lib/chunk-graph.js';
import parseGoogDeps from './lib/parse-goog-deps.js';
import generateHtml from './lib/generate-html.js';
import {NAMING_STYLE} from './lib/chunk-naming.js';

function resolveFrom(filepath, moduleId) {
  const requireFrom = Module.createRequire(filepath);
  return requireFrom.resolve(moduleId);
}

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const argv = yargs(process.argv)
    .version(packageJson.version)
    .option('entrypoint', {
      demandOption: true,
      describe: 'Format: <path/to/file>. Main entrypoint for the program. The first occurrence will be treated as the primary entrypoint. Additional entrypoints will be added as children of the primary entrypoint. Multiple files may be listed for a single entrypoint, separated by commas, to indicate they are both part of the same chunk.',
      type: 'string'
    })
    .option('manual-entrypoint', {
      describe: 'Format: <path/to/Parent>:<path/to/Child>. Add an arbitrary chunk entrypoint to the graph. Multiple children may be listed separated by commas.',
      type: 'string'
    })
    .option('root', {
      describe: 'Format: <path/to/project/root>. Path to the project root directory. The current working directory of the process is used by default.',
      type: 'string'
    })
    .option('closure-library-base-js-path', {
      describe: 'Format: <path/to/base.js>. Path to closure-library\'s base.js file. Required if closure-library or goog.module references are used.',
      type: 'string'
    })
    .option('deps-file', {
      describe: 'Fomrat: <path/to/deps.js>. Path to closure-library deps.js file or custom deps.js file. Used to find paths to closure-library namespaces.',
      type: 'string',
      requiresArg: 'closure-library-base-js-path'
    })
    .option('extra-deps', {
      describe: 'Format: <namespace>:<path/to/file>. Namespace and path to a file providing a closure namespace or module.',
      type: 'string',
      requiresArg: 'closure-library-base-js-path'
    })
    .option('visualize', {
      describe: 'Create and open an html page to visualize the graph.',
      type: 'boolean'
    })
    .option('package-json-entry-names', {
      describe: 'Ordered list of entries to look for in package.json files when resolving modules',
      default: 'browser,module,main',
      type: 'string'
    })
    .option('naming-style', {
      describe: 'How the name of a chunk is determined. For "entrypoint", chunk names are derived from the imported ' +
          'file name. For "numbered", the entrypoint is named "main" and child chunks are numeric indexes.',
      choices: Array.from(Object.values(NAMING_STYLE)),
      default: 'entrypoint',
      type: 'string'
    })
    .option('name-prefix', {
      describe: 'Prefix string prepended to each chunk name',
      default: '',
      type: 'string'
    })
    .strict()
    .help()
    .coerce('package-json-entry-names', (arg) => arg.split(/,\s*/g))
    .check((argv) => {
      if (argv.manualEntrypoint) {
        const manualEntrypoints = Array.isArray(argv.manualEntrypoint) ? argv.manualEntrypoint : [argv.manualEntrypoint];
        manualEntrypoints.forEach((manualEntrypoint) => {
          const parts = manualEntrypoint.split(':');
          if (parts.length < 2) {
            throw new Error('manual-entrypoints must be of the form "<path/to/Parent>:<path/to/Child>"');
          }
        });
      } else if (argv['extra-deps']) {
        const extraDeps = Array.isArray(argv['extra-deps']) ? argv['extra-deps'] : [argv['extra-deps']];
        extraDeps.forEach(dep => {
          const depParts = dep.split(':');
          if (depParts.length !== 2) {
            throw new Error('extra-deps must be of the form "<namespace>:<path/to/file>"');
          }
        });
      }
      return true;
    })
    .usage('Usage: node $0 --entrypoint src/main.js')
    .argv;

const flags = {};
Object.keys(argv).forEach((option) => {
  if (/^[a-z]/.test(option) && !/-/.test(option)) {
    flags[option] = argv[option];
  }
});

const entrypoints = (Array.isArray(flags.entrypoint) ? flags.entrypoint : [flags.entrypoint])
    .map(entrypoint => {
      const entrypointFiles = entrypoint.split(',')
          .map(entrypointFilePath => path.resolve(entrypointFilePath));
      return {
        name: entrypointFiles[0],
        files: entrypointFiles
      }
    });
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
  const childrenFiles = parts[1].split(',').map((filepath) => path.resolve(filepath));
  return {
    parent: path.resolve(parts[0]),
    child: {
      name: path.resolve(parts[1]),
      files: childrenFiles
    }
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

ChunkGraph
    .buildFromEntrypoints(
        entrypoints,
        manualEntrypoints,
        flags.packageJsonEntryNames,
        rootDir,
        googBasePath,
        googPathsByNamespace)
    .then((chunkGraph) => {
      const namingStyle = flags.namingStyle === NAMING_STYLE.NUMBERED ? NAMING_STYLE.NUMBERED : NAMING_STYLE.ENTRYPOINT;
      if (flags.visualize) {
        generateHtml(chunkGraph, flags.namePrefix, namingStyle)
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
        try {
          process.stdout.write(
              JSON.stringify(
                  chunkGraph.getClosureCompilerFlags(flags.namePrefix, namingStyle),
                  null,
                  2) +
              '\n');
        } catch (e) {
          process.stderr.write(`Error: ${e.message}\n`);
          process.exitCode = 1;
        }
      }
    });
