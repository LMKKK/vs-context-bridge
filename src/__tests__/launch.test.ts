import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('development launcher', () => {
  it('passes an absolute extension path to VS Code regardless of the invoking directory', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'autumn-context-bridge launch '));
    temporaryDirectories.push(directory);
    const bin = path.join(directory, 'bin');
    mkdirSync(bin);
    const output = path.join(directory, 'arguments.json');
    const capture = path.join(bin, 'capture.cjs');
    writeFileSync(capture, 'require("node:fs").writeFileSync(process.env.LAUNCH_ARGUMENTS_FILE, JSON.stringify(process.argv.slice(2)));');
    if (process.platform === 'win32') {
      writeFileSync(path.join(bin, 'code.cmd'), `@"${process.execPath}" "%~dp0capture.cjs" %*\r\n`);
    } else {
      writeFileSync(path.join(bin, 'code'), '#!/bin/sh\nexec "$LAUNCH_NODE" "$(dirname "$0")/capture.cjs" "$@"\n', { mode: 0o755 });
    }
    const extensionPath = path.resolve(__dirname, '../..');
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
    execFileSync(process.execPath, [path.join(extensionPath, 'scripts/launch.cjs'), '--skip-welcome'], {
      cwd: directory,
      env: {
        ...process.env,
        [pathKey]: bin + path.delimiter + process.env[pathKey],
        LAUNCH_NODE: process.execPath,
        LAUNCH_ARGUMENTS_FILE: output,
      },
    });
    const args: string[] = JSON.parse(readFileSync(output, 'utf8'));
    expect(args).toContain(`--extensionDevelopmentPath=${extensionPath}`);
    expect(args).toContain('--new-window');
    expect(args).toContain(extensionPath);
    expect(args).toContain('--skip-welcome');
    expect(args).not.toContain('--extensionDevelopmentPath=.');
  });
});
