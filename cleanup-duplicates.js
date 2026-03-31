#!/usr/bin/env node
// Removes duplicate entries from crontab-ui's NeDB database.
// Keeps the oldest entry for each unique (command, schedule) pair.
//
// Usage: sudo node cleanup-duplicates.js [crontab-ui-dir]

var fs = require('fs');
var path = require('path');

var crontabUiDir = process.argv[2];
if (!crontabUiDir) {
  var npmRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  crontabUiDir = path.join(npmRoot, 'crontab-ui');
}

var dbFile = path.join(crontabUiDir, 'crontabs', 'crontab.db');
if (!fs.existsSync(dbFile)) {
  console.log('  DB file not found at', dbFile);
  process.exit(1);
}

var lines = fs.readFileSync(dbFile, 'utf8').trim().split('\n').filter(Boolean);
var entries = [];
lines.forEach(function(line) {
  try { entries.push(JSON.parse(line)); } catch (e) {}
});

console.log('  Found', entries.length, 'entries');

// Group by (command, schedule), keep the one with the earliest created timestamp
var seen = {};
var keep = [];
var removed = 0;

entries.forEach(function(entry) {
  var key = entry.command + '|||' + entry.schedule;
  if (!seen[key]) {
    seen[key] = entry;
    keep.push(entry);
  } else {
    // Keep the one with earlier created time
    if (entry.created < seen[key].created) {
      keep = keep.filter(function(e) { return e._id !== seen[key]._id; });
      seen[key] = entry;
      keep.push(entry);
    }
    removed++;
  }
});

if (removed === 0) {
  console.log('  No duplicates found.');
  process.exit(0);
}

// Write back
var output = keep.map(function(e) { return JSON.stringify(e); }).join('\n') + '\n';
fs.writeFileSync(dbFile, output);
console.log('  Removed', removed, 'duplicates. Kept', keep.length, 'entries.');
