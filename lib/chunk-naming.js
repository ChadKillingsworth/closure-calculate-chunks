import path from 'path';

/** @enum {string} */
export const NAMING_STYLE = {
  ENTRYPOINT: 'entrypoint',
  NUMBERED: 'numbered'
};

/**
 * @param {string} entrypoint
 * @param {!NAMING_STYLE=} namingStyle
 * @return {function(string): string}
 */
export const outputChunkNaming = (entrypoint, namingStyle = NAMING_STYLE.ENTRYPOINT) => {
  let chunkNameIndex = 0;
  let outputChunkNames = new Map();
  return (chunkName) => {
    if (!outputChunkNames.has(chunkName)) {
      if (namingStyle === NAMING_STYLE.NUMBERED) {
        if (chunkName === entrypoint) {
          outputChunkNames.set(chunkName, 'main.js');
        } else {
          outputChunkNames.set(chunkName, `${chunkNameIndex++}.js`);
        }
      } else {
        outputChunkNames.set(chunkName, path.relative(process.cwd(), chunkName));
      }
    }
    return outputChunkNames.get(chunkName);
  };
};
