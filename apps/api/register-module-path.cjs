/**
 * Preload script for production (PM2 / node -r).
 * npm workspaces install API deps under apps/api/node_modules;
 * this registers both workspace node_modules paths before Nest boots.
 */
const path = require('path');
const Module = require('module');

const apiDir = __dirname;
const root = path.join(apiDir, '..', '..');
const nodePath = [
  path.join(root, 'node_modules'),
  path.join(apiDir, 'node_modules'),
]
  .filter((p) => {
    try {
      require('fs').accessSync(p);
      return true;
    } catch {
      return false;
    }
  })
  .join(path.delimiter);

if (nodePath) {
  process.env.NODE_PATH = nodePath;
  Module._initPaths();
}
