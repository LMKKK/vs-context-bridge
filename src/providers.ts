import {
  matchesClaudeTerminalName,
  matchesCodexTerminalName,
  formatLineRef,
  formatCodexFileRef,
  formatCodexLineRef,
} from './matching';

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly patternsSetting?: string;
  readonly statusBarPriority: number;
  readonly designateTitle?: string;
  readonly commands: {
    readonly addFiles: string;
    readonly sendSelection: string;
    readonly designate: string;
    readonly selectTerminal: string;
  };
  matchesTerminalName(name: string, customPatterns: string[]): boolean;
  formatFileRef(filePath: string): string;
  formatSelectionRef(filePath: string, startLine: number, endLine: number): string;
}

export const CLAUDE: Provider = {
  id: 'claude',
  name: 'Claude Code',
  patternsSetting: 'terminalNamePatterns',
  statusBarPriority: 50,
  commands: {
    addFiles: 'autumnContextBridge.addFileToContext',
    sendSelection: 'autumnContextBridge.sendSelectionToContext',
    designate: 'autumnContextBridge.setAsClaudeTerminal',
    selectTerminal: 'autumnContextBridge.selectTerminal',
  },
  matchesTerminalName: matchesClaudeTerminalName,
  formatFileRef: (filePath) => `@${filePath}`,
  formatSelectionRef: formatLineRef,
};

export const CODEX: Provider = {
  id: 'codex',
  name: 'Codex',
  patternsSetting: 'codexTerminalNamePatterns',
  statusBarPriority: 49,
  commands: {
    addFiles: 'autumnContextBridge.addFileToCodex',
    sendSelection: 'autumnContextBridge.sendSelectionToCodex',
    designate: 'autumnContextBridge.setAsCodexTerminal',
    selectTerminal: 'autumnContextBridge.selectCodexTerminal',
  },
  matchesTerminalName: matchesCodexTerminalName,
  formatFileRef: formatCodexFileRef,
  formatSelectionRef: formatCodexLineRef,
};
