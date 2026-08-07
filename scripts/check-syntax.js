// Fast pre-build syntax gate. Catches parse errors in the main-process /
// preload scripts and in the inline <script> blocks of the HTML windows,
// which otherwise only surface at runtime (or waste a full CI build).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;

function fail(file, err) {
  failed++;
  console.error(`FAIL ${file}\n  ${err.message}`);
}

// Node files: compile without executing. Enumerated rather than hardcoded so a
// newly added script can't be silently skipped. screenshot.js is a local-only
// dev tool (gitignored) and isn't part of the app.
const jsFiles = fs.readdirSync(root)
  .filter((f) => f.endsWith('.js') && f !== 'screenshot.js')
  .sort();

for (const file of jsFiles) {
  const full = path.join(root, file);
  try {
    new vm.Script(fs.readFileSync(full, 'utf8'), { filename: file });
    console.log(`ok   ${file}`);
  } catch (e) {
    fail(file, e);
  }
}

// HTML files: parse each inline <script> body.
for (const file of ['settings.html', 'magnet-popup.html']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, 'utf8');
  const blocks = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  try {
    blocks.forEach(([, body], i) => {
      new vm.Script(body, { filename: `${file} <script #${i + 1}>` });
    });
    console.log(`ok   ${file} (${blocks.length} script block${blocks.length === 1 ? '' : 's'})`);
  } catch (e) {
    fail(file, e);
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed to parse.`);
  process.exit(1);
}
console.log('\nAll files parsed cleanly.');
