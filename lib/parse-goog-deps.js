const acorn = require('acorn');
const walk = require('acorn-walk');
const path = require('path');

/**
 *
 * @param {string} contents
 * @param {string} googBaseDir full path to the closure-library
 */
module.exports = function parseGoogDeps(contents, googBaseDir) {
  const googPathsByNamespace = new Map();
  const ast = acorn.Parser.parse(contents, {ecmaVersion: 2020});
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
  return googPathsByNamespace;
};
