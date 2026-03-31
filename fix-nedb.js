#!/usr/bin/env node
/**
 * Fix NeDB files for Node.js v23+ compatibility.
 * Removes any previously broken polyfill injection and prepends a clean IIFE polyfill.
 * Safe to run on both patched and unpatched files.
 */
var fs = require('fs');
var path = require('path');

// Accept crontab-ui dir as argument, or auto-detect
var crontabUiDir = process.argv[2];
if (!crontabUiDir) {
  crontabUiDir = path.join(require('child_process').execSync('npm root -g', {encoding: 'utf8'}).trim(), 'crontab-ui');
}
if (!fs.existsSync(crontabUiDir)) {
  console.error('ERROR: Could not find crontab-ui at ' + crontabUiDir);
  process.exit(1);
}

var nedbDir = path.join(crontabUiDir, 'node_modules', 'nedb', 'lib');
var files = ['model.js', 'datastore.js', 'indexes.js'];

var polyfill = [
  '// Polyfill deprecated util functions for Node.js v23+',
  '(function() {',
  '  var _util = require("util");',
  '  if (!_util.isArray) { _util.isArray = Array.isArray; }',
  '  if (!_util.isDate) { _util.isDate = function(d) { return Object.prototype.toString.call(d) === "[object Date]"; }; }',
  '  if (!_util.isRegExp) { _util.isRegExp = function(r) { return Object.prototype.toString.call(r) === "[object RegExp]"; }; }',
  '})();',
  ''
].join('\n');

files.forEach(function(file) {
  var filePath = path.join(nedbDir, file);
  if (!fs.existsSync(filePath)) {
    console.log('  SKIP: ' + file + ' not found');
    return;
  }

  var content = fs.readFileSync(filePath, 'utf8');

  // Remove any previously injected (broken) polyfill
  // Pattern: the old inline polyfill that was inserted mid-var-chain
  content = content.replace(/\n?\/\/ Polyfill deprecated util functions for Node\.js v23\+\n(?:if \(!util\.is\w+\)[^\n]+\n)+\n?/g, '');

  // Also remove any previously prepended IIFE polyfill
  content = content.replace(/^\/\/ Polyfill deprecated util functions for Node\.js v23\+\n\(function\(\) \{[\s\S]*?\}\)\(\);\n/g, '');

  // Prepend the clean polyfill
  content = polyfill + content;

  fs.writeFileSync(filePath, content);
  console.log('  FIXED: ' + file);
});

console.log('  Done. Restart crontab-ui to apply.');
