const path = require('node:path');
const spawn = require('cross-spawn');

// The VS Code GUI can resolve relative development paths against a different
// working directory. Always pass the extension's absolute path, including when
// this script is launched from another directory. cross-spawn handles code.cmd
// and paths containing spaces on Windows.
const extensionPath = path.resolve(__dirname, '..');
const result = spawn.sync('code', [
  '--new-window',
  `--extensionDevelopmentPath=${extensionPath}`,
  extensionPath,
  ...process.argv.slice(2),
], { stdio: 'inherit' });

if (result.error) {
  console.error(`Unable to launch VS Code: ${result.error.message}`);
}
process.exitCode = result.status ?? 1;
