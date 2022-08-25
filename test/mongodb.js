const fs = require('fs');
const path = require('path');

const hasOwn = (object, prop) => Object.prototype.hasOwnProperty.call(object, prop);
function* walkDir(root) {
  const directoryContents = fs.readdirSync(root);
  for (const filepath of directoryContents) {
    const fullPath = path.join(root, filepath);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      yield* walkDir(fullPath);
    } else if (stat.isFile()) {
      yield fullPath;
    }
  }
}

module.exports = Object.create(null);
Object.defineProperty(module.exports, '__esModule', { value: true });

const sourceFiles = Array.from(walkDir(path.resolve(__dirname, '../src')), fileName =>
  fileName.slice(fileName.indexOf('src'), fileName.length - 3)
);
sourceFiles.sort((a, b) => a.localeCompare(b));
const typesContent = `/* This file is auto generated do not edit */
${sourceFiles.map(fn => `export * from '../${fn}';`).join('\n')}
`;
fs.writeFileSync(path.resolve(__dirname, 'mongodb.d.ts'), Buffer.from(typesContent, 'utf8'));

const entryPoint = require('../nodejs-mongodb-legacy');

for (const [exportKey, exportValue] of Object.entries(entryPoint)) {
  module.exports[exportKey] = exportValue;
}

for (const sourceFile of walkDir(path.resolve(__dirname, '../src'))) {
  const mod = require(`${sourceFile}`);

  for (const [exportKey, exportValue] of Object.entries(mod)) {
    if (hasOwn(entryPoint, exportKey)) {
      continue; // entryPoint exports are preserved
    }

    if (hasOwn(module.exports, exportKey)) {
      throw new Error(`Cannot merge the exports from ${sourceFile}, ${exportKey} already exists`);
    }

    module.exports[exportKey] = exportValue;
  }
}
