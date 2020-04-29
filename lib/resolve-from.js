const Module = require('module');
module.exports = (filepath, moduleId) => {
  const requireFrom = Module.createRequire(filepath);
  return requireFrom.resolve(moduleId);
};
