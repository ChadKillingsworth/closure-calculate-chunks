const Module = require('module');

function findMainEntryWithPackageJsonEntryNames(requireFrom, packageJsonEntryNames, moduleId) {
  try {
    const packageJson = requireFrom(`${moduleId}/package.json`);
    for (let i = 0; i < packageJsonEntryNames.length; i++) {
      if (packageJson[packageJsonEntryNames[i]]) {
        return `${moduleId}/${packageJson[packageJsonEntryNames[i]]}`;
      }
    }
  } catch (e) {}
  return moduleId;
}

module.exports = (filepath, moduleId, packageJsonEntryNames = []) => {
  const requireFrom = Module.createRequire(filepath);
  if (/^[\.\/]/.test(moduleId)) {
    return requireFrom.resolve(moduleId);
  }

  const pathParts = moduleId.split(/\/|\\/);
  let moduleIdFromPackageEntryNames = moduleId;
  if (pathParts.length === 1) {
    moduleIdFromPackageEntryNames =
        findMainEntryWithPackageJsonEntryNames(requireFrom, packageJsonEntryNames, moduleId);
  } else if (pathParts.length === 2 && pathParts[0][0] === '@') {
    moduleIdFromPackageEntryNames =
        findMainEntryWithPackageJsonEntryNames(requireFrom, packageJsonEntryNames, moduleId);
  }

  return requireFrom.resolve(moduleIdFromPackageEntryNames);
};
