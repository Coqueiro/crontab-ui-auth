#!/usr/bin/env node
// Patches crontab-ui's import_crontab function to unwrap commands
// that were previously wrapped by make_command.
// This prevents duplicates when doing "Get from crontab" after "Save to crontab".
//
// Usage: node fix-import.js [crontab-ui-dir]
// Idempotent: safe to run multiple times.

var fs = require('fs');
var path = require('path');

// Resolve crontab-ui directory
var crontabUiDir = process.argv[2];
if (!crontabUiDir) {
  var npmRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
  crontabUiDir = path.join(npmRoot, 'crontab-ui');
}

var crontabJs = path.join(crontabUiDir, 'crontab.js');

if (!fs.existsSync(crontabJs)) {
  console.log('  SKIP: crontab.js not found at', crontabJs);
  process.exit(0);
}

var content = fs.readFileSync(crontabJs, 'utf8');

// Idempotency check — need unwrap_command + callback + fallback dedup
if (content.indexOf('unwrap_command') !== -1 && content.indexOf('import_crontab = function(callback)') !== -1 && content.indexOf('fall back to command+schedule dedup') !== -1) {
  console.log('  Already patched (with callback + fallback dedup), skipping.');
  process.exit(0);
}

// Find the import_crontab function to replace (could be original or our old non-callback version)
var oldFuncRegex = /(?:\/\/ Unwrap commands that were wrapped by make_command\n)?(?:function unwrap_command[\s\S]*?\n\}\n\n)?exports\.import_crontab\s*=\s*function\([^)]*\)\s*\{[\s\S]*?\n\};\n/;
if (!oldFuncRegex.test(content)) {
  console.error('  ERROR: Could not find exports.import_crontab function to patch');
  process.exit(1);
}

// New code: unwrap_command helper + improved import_crontab
var newCode = [
  '// Unwrap commands that were wrapped by make_command',
  'function unwrap_command(cmd) {',
  '  // Strip env_vars outer wrapper: (ENV_VARS; (INNER))',
  '  var inner = cmd;',
  '  var envMatch = cmd.match(/^\\((.+);\\s*\\(([\\s\\S]+)\\)\\)$/);',
  '  if (envMatch) {',
  '    inner = envMatch[2];',
  '  }',
  '  // Detect make_command wrapping: ((({ ORIGINAL; } | tee /path/ID.stdout) ...',
  '  var wrapMatch = inner.match(/^\\(\\(\\(\\{\\s*([\\s\\S]+?)\\s*\\}\\s*\\|\\s*tee\\s+\\S+\\/([^.]+)\\.stdout\\)/);',
  '  if (!wrapMatch) return null;',
  '  var originalCmd = wrapMatch[1].replace(/;$/, "").trim();',
  '  var jobId = wrapMatch[2];',
  '  return { command: originalCmd, jobId: jobId };',
  '}',
  '',
  'exports.import_crontab = function(callback){',
  '	exec("crontab -l", function(error, stdout, stderr){',
  '		if (error) { if (callback) callback(error); return; }',
  '		var lines = stdout.split("\\n");',
  '		var namePrefix = new Date().getTime();',
  '		var pending = 0;',
  '		var finished = false;',
  '		function checkDone() { if (finished && pending === 0 && callback) callback(); }',
  '',
  '		lines.forEach(function(line, index){',
  '			line = line.replace(/\\t+/g, " ");',
  '			var regex = /^((\\@[a-zA-Z]+\\s+)|(([^\\s]+)\\s+([^\\s]+)\\s+([^\\s]+)\\s+([^\\s]+)\\s+([^\\s]+)\\s+))/;',
  '			var command = line.replace(regex, "").trim();',
  '			var schedule = line.replace(command, "").trim();',
  '',
  '			var is_valid = false;',
  '			try { is_valid = !!CronExpressionParser.parse(schedule); } catch (e){}',
  '',
  '			if(command && schedule && is_valid){',
  '				// Try to unwrap commands that were wrapped by make_command',
  '				var unwrapped = unwrap_command(command);',
  '				var actualCommand = unwrapped ? unwrapped.command : command;',
  '				var jobId = unwrapped ? unwrapped.jobId : null;',
  '				var name = namePrefix + "_" + index;',
  '				pending++;',
  '',
  '				if (jobId) {',
  '					// We know the job ID - look it up directly',
  '					db.findOne({ _id: jobId }, function(err, doc) {',
  '						if (err) { console.error("DB error:", err); pending--; checkDone(); return; }',
  '						if (doc) {',
  '							// Job exists, mark as saved (it is in the crontab)',
  '							db.update({ _id: jobId }, { $set: { saved: true } }, {}, function() { pending--; checkDone(); });',
  '						} else {',
  '							// Job ID not in DB - fall back to command+schedule dedup',
  '							db.findOne({ command: actualCommand, schedule: schedule }, function(err2, doc2) {',
  '								if (err2) { console.error("DB error:", err2); pending--; checkDone(); return; }',
  '								if (doc2) {',
  '									db.update({ _id: doc2._id }, { $set: { saved: true } }, {}, function() { pending--; checkDone(); });',
  '								} else {',
  '									exports.create_new(name, actualCommand, schedule, null, null, function() { pending--; checkDone(); });',
  '								}',
  '							});',
  '						}',
  '					});',
  '				} else {',
  '					// No job ID (not wrapped) - use command+schedule dedup',
  '					db.findOne({ command: actualCommand, schedule: schedule }, function(err, doc) {',
  '						if (err) { console.error("DB error:", err); pending--; checkDone(); return; }',
  '						if (!doc) {',
  '							exports.create_new(name, actualCommand, schedule, null, null, function() { pending--; checkDone(); });',
  '						} else {',
  '							doc.command = actualCommand;',
  '							doc.schedule = schedule;',
  '							exports.update(doc, function() { pending--; checkDone(); });',
  '						}',
  '					});',
  '				}',
  '			}',
  '		});',
  '		finished = true;',
  '		checkDone();',
  '	});',
  '};',
  ''
].join('\n');

content = content.replace(oldFuncRegex, newCode);
fs.writeFileSync(crontabJs, content);
console.log('  Patched import_crontab ✓');
