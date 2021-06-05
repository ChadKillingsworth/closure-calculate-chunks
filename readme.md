# closure-calculate-chunks

A utility to parse JS files, determine dependencies and specify which output chunk source files
appear in for closure-compiler. Uses node module resolution and determines
split points from dynamic import statements.

**Usage:**
```
npx closure-calculate-chunks --entrypoint ./src/js/entry.js
```

## Flags

**--entrypoint path/toFile**  
Required flag. Initial entrypoint to the application. This flag may occur multiple times,
but the first usage will be the true entrypoint and is where the language polyfills will be
injected by closure-compiler. All other entrypoints will have a dependence on the first
entrypoint.

**--manual-entrypoint path/to/parent/chunk:path/to/entrypoint**  
Add a custom entrypoint for code that is not discoverable.

**--closure-library-base-js-path path/to/google-closure-library/closure/goog/base.js**  
Path to closure-library's base.js file. This flag is only needed for projects which include
Closure-Library style dependencies.

**--deps-file path/to/closure/deps.js**  
Path to a Closure-Library style deps.js file. This flag may occur multiple times. This flag is only
needed for projects which include Closure-Library style dependencies.

**--extra-deps namespace:path/to/providing/src**  
Provided namespace and filepath for a Closure-Library style namespace.
This flag may occur multiple times. This flag is only needed for projects which include
Closure-Library style dependencies and for namespaces which are not found in a deps.js file.
 
**--package-json-entry-names field1,field2,...**  
Ordered list of entries to look for in package.json files when resolving modules. Defaults to
"browser,module,main".
 
**--visualize**  
Instead of outputting the closure compiler flags, open an HTML page to visualize the graph.

**--naming-style [entrypoint, numbered]**  
How the name of a chunk is determined. For "entrypoint", chunk names are derived from the imported
file name. For "numbered", the entrypoint is named "main" and child chunks are numeric indexes.

**--name-prefix prefix**  
Prefix string prepended to each chunk name.

## Output
Outputs a JSON object with closure-compiler chunk definitions and source files in dependency order.

```json
{
  "chunk": [
    "baseChunkName:numFiles",
    "childChunkName:numFiles:baseChunkName"
  ],
  "js": [
    "file1.js",
    "file2.js"
  ]
}
```

## Why Sources End Up in Other Chunks

Closure Compiler will not duplicate code. If a source file is utilized in more than one output
chunk, this utility will hoist the file up into the lowest common ancestor which is common to
all paths.
