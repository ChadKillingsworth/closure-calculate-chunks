# closure-calculate-chunks

A utility to parse JS files, determine dependencies and split code into
output chunks for closure-compiler. Uses node module resolution and determines
split points from dynamic import statements.

**Usage:**
```
node --preserve-symlinks node_modules/closure-calculate-chunks/index.js --entrypoint ./src/js/entry.js
```

## Flags

 - **--entrypoint path/toFile** required. initial entrypoint to the application. This flag may occur multiple times, but the first usage will be the true entrypoint and will have the language polyfills injected by closure-compiler. All other entrypoints will have a dependence on the first entrypoint.

 - **--manual-entrypoint path/to/parent/chunk:path/to/entrypoint** add a custom entrypoint for code that is not discoverable.

 - **--closure-library-base-js-path path/to/google-closure-library/closure/goog/base.js** path to closure-library's base.js file

 - **--deps-file path/to/closure/deps.js** This flag may occur multiple times.

 - **--extra-deps namespace:path/to/providing/src** This flag may occur multiple times.

## Output
Outputs a JSON object with closure-compiler chunk definitions and source files in dependency order.

```json
{
  "chunk": [
    "baseChunkName:numFiles",
    "childChunkName:numFiles:baseChunkName"
  ],
  "sources": [
    "file1.js",
    "file2.js"
  ]
}
```
