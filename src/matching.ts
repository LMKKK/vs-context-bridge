const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export function matchesClaudeTerminalName(
  name: string,
  customPatterns: string[] = [],
): boolean {
  if (name === 'Claude Code') return true;
  if (name.toLowerCase().includes('claude')) return true;
  if (VERSION_PATTERN.test(name)) return true;

  return matchesCustomPatterns(name, customPatterns);
}

export function matchesCodexTerminalName(
  name: string,
  customPatterns: string[] = [],
): boolean {
  return name.toLowerCase().includes('codex') || matchesCustomPatterns(name, customPatterns);
}

export function matchesCustomPatterns(name: string, customPatterns: string[]): boolean {
  for (const pattern of customPatterns) {
    try {
      if (new RegExp(pattern, 'i').test(name)) return true;
    } catch {
      // Invalid regex — skip
    }
  }

  return false;
}

export function toRelativePath(
  fileFsPath: string,
  workspaceFolderFsPaths: string[],
): string {
  // Use Node's path to compute relative paths
  const path = require('path');

  for (const folderPath of workspaceFolderFsPaths) {
    const rel = path.relative(folderPath, fileFsPath);
    if (!rel.startsWith('..')) {
      return rel;
    }
  }

  // Fallback: absolute path
  return fileFsPath;
}

export function formatLineRef(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  if (startLine === endLine) {
    return `@${filePath}:${startLine}`;
  }
  return `@${filePath}:${startLine}-${endLine}`;
}

export function formatCodexFileRef(filePath: string): string {
  // Plain prompt text, not a shell argument or a native attachment token.
  return /[\s"]/.test(filePath) ? JSON.stringify(filePath) : filePath;
}

export function formatCodexLineRef(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  const path = formatCodexFileRef(filePath);
  return startLine === endLine
    ? `${path}:${startLine}`
    : `${path}:${startLine}-${endLine}`;
}
