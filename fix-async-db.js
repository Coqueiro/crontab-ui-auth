#!/usr/bin/env node
// Patches crontab-ui to fix a race condition: NeDB operations are async but the server
// responds before they complete, causing the UI to show stale data on reload.
//
// This adds callbacks to database operations in crontab.js and updates route handlers
// in app.js to wait for those callbacks before responding.
//
// Usage: node fix-async-db.js [crontab-ui-dir]
// Idempotent: safe to run multiple times (checks for callback_patched marker).

var fs = require('fs');
var path = require('path');

// Resolve crontab-ui directory
var crontabUiDir = process.argv[2];
if (!crontabUiDir) {
  var npmRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  crontabUiDir = path.join(npmRoot, 'crontab-ui');
}

var crontabJs = path.join(crontabUiDir, 'crontab.js');
var appJs = path.join(crontabUiDir, 'app.js');

// Patch crontab.js
if (fs.existsSync(crontabJs)) {
  var crontabContent = fs.readFileSync(crontabJs, 'utf8');

  // Idempotency check for crontab.js — need callback_patched + createHash + logging default
  if (crontabContent.indexOf('callback_patched') !== -1 && crontabContent.indexOf('createHash') !== -1 && crontabContent.indexOf('logging = logging || "true"') !== -1) {
    console.log('  crontab.js already patched, skipping.');
  } else {
    var patched = false;

    // Patch create_new — add callback + deterministic _id + force logging=true
    // Match original, v2 (callback-only), and v3 (callback+hash but no logging default)
    var create_new_old = 'exports.create_new = function(name, command, schedule, logging, mailing){\n\tvar tab = crontab(name, command, schedule, false, logging, mailing);\n\ttab.created = new Date().valueOf();\n\ttab.saved = false;\n\tdb.insert(tab);\n};';
    var create_new_old_v2 = 'exports.create_new = function(name, command, schedule, logging, mailing, callback){ // callback_patched\n\tvar tab = crontab(name, command, schedule, false, logging, mailing);\n\ttab.created = new Date().valueOf();\n\ttab.saved = false;\n\tdb.insert(tab, function(err) { if (callback) callback(err); });\n};';
    var create_new_old_v3 = 'exports.create_new = function(name, command, schedule, logging, mailing, callback){ // callback_patched\n\tvar tab = crontab(name, command, schedule, false, logging, mailing);\n\ttab.created = new Date().valueOf();\n\ttab.saved = false;\n\ttab._id = require("crypto").createHash("sha256").update(command + "|" + schedule).digest("hex").substring(0, 16);\n\tdb.insert(tab, function(err) {\n\t\tif (err && err.errorType === "uniqueViolated") {\n\t\t\tdb.update({_id: tab._id}, {$set: {name: tab.name, logging: tab.logging, mailing: tab.mailing, saved: tab.saved}}, {}, function(err2) { if (callback) callback(err2); });\n\t\t} else { if (callback) callback(err); }\n\t});\n};';
    var create_new_new = 'exports.create_new = function(name, command, schedule, logging, mailing, callback){ // callback_patched\n\tlogging = logging || "true";\n\tvar tab = crontab(name, command, schedule, false, logging, mailing);\n\ttab.created = new Date().valueOf();\n\ttab.saved = false;\n\ttab._id = require("crypto").createHash("sha256").update(command + "|" + schedule).digest("hex").substring(0, 16);\n\tdb.insert(tab, function(err) {\n\t\tif (err && err.errorType === "uniqueViolated") {\n\t\t\tdb.update({_id: tab._id}, {$set: {name: tab.name, logging: tab.logging, mailing: tab.mailing, saved: tab.saved}}, {}, function(err2) { if (callback) callback(err2); });\n\t\t} else { if (callback) callback(err); }\n\t});\n};';
    if (crontabContent.indexOf(create_new_old_v3) !== -1) {
      crontabContent = crontabContent.replace(create_new_old_v3, create_new_new);
      patched = true;
    } else if (crontabContent.indexOf(create_new_old_v2) !== -1) {
      crontabContent = crontabContent.replace(create_new_old_v2, create_new_new);
      patched = true;
    } else if (crontabContent.indexOf(create_new_old) !== -1) {
      crontabContent = crontabContent.replace(create_new_old, create_new_new);
      patched = true;
    }

    // Patch update
    var update_old = 'exports.update = function(data){\n\tvar tab = crontab(data.name, data.command, data.schedule, null, data.logging, data.mailing);\n\ttab.saved = false;\n\tdb.update({_id: data._id}, tab);\n};';
    var update_new = 'exports.update = function(data, callback){ // callback_patched\n\tvar tab = crontab(data.name, data.command, data.schedule, null, data.logging, data.mailing);\n\ttab.saved = false;\n\tdb.update({_id: data._id}, tab, {}, function(err) { if (callback) callback(err); });\n};';
    if (crontabContent.indexOf(update_old) !== -1) {
      crontabContent = crontabContent.replace(update_old, update_new);
      patched = true;
    }

    // Patch status
    var status_old = 'exports.status = function(_id, stopped){\n\tdb.update({_id: _id},{$set: {stopped: stopped, saved: false}});\n};';
    var status_new = 'exports.status = function(_id, stopped, callback){ // callback_patched\n\tdb.update({_id: _id},{$set: {stopped: stopped, saved: false}}, {}, function(err) { if (callback) callback(err); });\n};';
    if (crontabContent.indexOf(status_old) !== -1) {
      crontabContent = crontabContent.replace(status_old, status_new);
      patched = true;
    }

    // Patch remove
    var remove_old = 'exports.remove = function(_id){\n\tdb.remove({_id: _id}, {});\n};';
    var remove_new = 'exports.remove = function(_id, callback){ // callback_patched\n\tdb.remove({_id: _id}, {}, function(err) { if (callback) callback(err); });\n};';
    if (crontabContent.indexOf(remove_old) !== -1) {
      crontabContent = crontabContent.replace(remove_old, remove_new);
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(crontabJs, crontabContent);
      console.log('  Patched crontab.js ✓');
    } else {
      console.log('  WARNING: Could not find expected function signatures in crontab.js');
    }
  }
} else {
  console.log('  SKIP: crontab.js not found at', crontabJs);
}

// Patch app.js
if (fs.existsSync(appJs)) {
  var appContent = fs.readFileSync(appJs, 'utf8');

  // Idempotency check for app.js
  if (appContent.indexOf('callback_patched') !== -1) {
    console.log('  app.js already patched, skipping.');
  } else {
    var patched = false;

    // Patch POST /save
    var save_old = 'app.post(routes.save, function(req, res) {\n\t// new job\n\tif(req.body._id == -1){\n\t\tcrontab.create_new(req.body.name, req.body.command, req.body.schedule, req.body.logging, req.body.mailing);\n\t}\n\t// edit job\n\telse{\n\t\tcrontab.update(req.body);\n\t}\n\tres.end();\n});';
    var save_new = 'app.post(routes.save, function(req, res) { // callback_patched\n\tfunction done(err) { if (err) console.error(err); res.end(); }\n\t// new job\n\tif(req.body._id == -1){\n\t\tcrontab.create_new(req.body.name, req.body.command, req.body.schedule, req.body.logging, req.body.mailing, done);\n\t}\n\t// edit job\n\telse{\n\t\tcrontab.update(req.body, done);\n\t}\n});';
    if (appContent.indexOf(save_old) !== -1) {
      appContent = appContent.replace(save_old, save_new);
      patched = true;
    }

    // Patch POST /stop
    var stop_old = 'app.post(routes.stop, function(req, res) {\n\tcrontab.status(req.body._id, true);\n\tres.end();\n});';
    var stop_new = 'app.post(routes.stop, function(req, res) { // callback_patched\n\tcrontab.status(req.body._id, true, function(err) { if (err) console.error(err); res.end(); });\n});';
    if (appContent.indexOf(stop_old) !== -1) {
      appContent = appContent.replace(stop_old, stop_new);
      patched = true;
    }

    // Patch POST /start
    var start_old = 'app.post(routes.start, function(req, res) {\n\tcrontab.status(req.body._id, false);\n\tres.end();\n});';
    var start_new = 'app.post(routes.start, function(req, res) { // callback_patched\n\tcrontab.status(req.body._id, false, function(err) { if (err) console.error(err); res.end(); });\n});';
    if (appContent.indexOf(start_old) !== -1) {
      appContent = appContent.replace(start_old, start_new);
      patched = true;
    }

    // Patch POST /remove
    var remove_old = 'app.post(routes.remove, function(req, res) {\n\tcrontab.remove(req.body._id);\n\tres.end();\n});';
    var remove_new = 'app.post(routes.remove, function(req, res) { // callback_patched\n\tcrontab.remove(req.body._id, function(err) { if (err) console.error(err); res.end(); });\n});';
    if (appContent.indexOf(remove_old) !== -1) {
      appContent = appContent.replace(remove_old, remove_new);
      patched = true;
    }

    // Patch GET /import_crontab
    var import_old = 'app.get(routes.import_crontab, function(req, res) {\n\tcrontab.import_crontab();\n\tres.end();\n});';
    var import_new = 'app.get(routes.import_crontab, function(req, res) { // callback_patched\n\tcrontab.import_crontab(function(err) { if (err) console.error(err); res.end(); });\n});';
    if (appContent.indexOf(import_old) !== -1) {
      appContent = appContent.replace(import_old, import_new);
      patched = true;
    }

    if (patched) {
      fs.writeFileSync(appJs, appContent);
      console.log('  Patched app.js ✓');
    } else {
      console.log('  WARNING: Could not find expected route handlers in app.js');
    }
  }
} else {
  console.log('  SKIP: app.js not found at', appJs);
}

// === Patch popup.ejs: default logging checkbox to checked ===
var popupEjs = path.join(crontabUiDir, 'views', 'popup.ejs');
if (fs.existsSync(popupEjs)) {
  var popupContent = fs.readFileSync(popupEjs, 'utf8');
  var unchecked = '<input type="checkbox" id="job-logging"';
  var checked = '<input type="checkbox" id="job-logging" checked';
  if (popupContent.indexOf(checked) !== -1) {
    console.log('  popup.ejs already patched (logging checked), skipping.');
  } else if (popupContent.indexOf(unchecked) !== -1) {
    popupContent = popupContent.replace(unchecked, checked);
    fs.writeFileSync(popupEjs, popupContent);
    console.log('  Patched popup.ejs (logging checkbox default checked) ✓');
  } else {
    console.log('  WARNING: Could not find logging checkbox in popup.ejs');
  }
} else {
  console.log('  SKIP: popup.ejs not found at', popupEjs);
}

console.log('  Done. Restart crontab-ui to apply.');
