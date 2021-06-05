import path from 'path';

/** @enum {string} */
export const NAMING_STYLE = {
  ENTRYPOINT: 'entrypoint',
  NUMBERED: 'numbered'
};

/**
 * @param {string} entrypoint
 * @param {string=} namePrefix
 * @param {!NAMING_STYLE=} namingStyle
 * @return {function(string): string}
 */
export const outputChunkNaming = (entrypoint, namePrefix = '', namingStyle = NAMING_STYLE.ENTRYPOINT) => {
  let chunkNameIndex = 0;
  const outputChunkNames = new Map();
  const usedNames = new Set();
  return (chunkName) => {
    if (!outputChunkNames.has(chunkName)) {
      if (namingStyle === NAMING_STYLE.NUMBERED) {
        if (chunkName === entrypoint) {
          outputChunkNames.set(chunkName, `${namePrefix}main`);
        } else {
          outputChunkNames.set(chunkName, `${namePrefix}${chunkNameIndex++}`);
        }
      } else {
        let outputChunkName = namePrefix + path.basename(chunkName, path.extname(chunkName));
        let proposedName = outputChunkName;
        for (let suffix = 1; usedNames.has(proposedName); suffix++) {
          proposedName = outputChunkName + suffix;
        }
        outputChunkName = proposedName;
        usedNames.add(outputChunkName);
        outputChunkNames.set(chunkName, outputChunkName);
      }
    }
    return outputChunkNames.get(chunkName);
  };
};
