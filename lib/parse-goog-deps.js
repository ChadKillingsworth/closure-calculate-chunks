import {Parser} from 'acorn';
import {simple as simpleWalk} from 'acorn-walk';
import path from 'path';

/**
 * Parse a deps.js file from a Closure-Library style project and build a map of provided names to file location
 *
 * @param {string} contents
 * @param {string} baseDir full path to the closure-library
 */
export default function parseGoogDeps(contents, baseDir) {
  const googPathsByNamespace = new Map();
  const ast = Parser.parse(contents, {ecmaVersion: 2020});
  simpleWalk(ast, {
    CallExpression(node) {
      if (node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'goog' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'addDependency') {
        const filePath = path.resolve(baseDir, node.arguments[0].value);
        node.arguments[1].elements.forEach((arg) => googPathsByNamespace.set(arg.value, filePath));
      }
    }
  });
  return googPathsByNamespace;
};
