import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  class Emitter {
    listeners = new Set<(value: any) => void>();
    event = (listener: (value: any) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(value?: any) {
      for (const listener of this.listeners) listener(value);
    }
    dispose() { this.listeners.clear(); }
  }
  const events = {
    open: new Emitter(), close: new Emitter(), active: new Emitter(),
    config: new Emitter(), selection: new Emitter(), editor: new Emitter(),
  };
  return {
    Emitter, events,
    patterns: {} as Record<string, string[]>,
    commands: new Map<string, (...args: any[]) => any>(),
    statusItems: [] as any[],
    window: {
      terminals: [] as any[],
      activeTerminal: undefined as any,
      activeTextEditor: undefined as any,
      onDidOpenTerminal: events.open.event,
      onDidCloseTerminal: events.close.event,
      onDidChangeActiveTerminal: events.active.event,
      onDidChangeTextEditorSelection: events.selection.event,
      onDidChangeActiveTextEditor: events.editor.event,
      showWarningMessage: vi.fn(), showInformationMessage: vi.fn(), showQuickPick: vi.fn(),
      createStatusBarItem: vi.fn(),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/project' } }],
      onDidChangeConfiguration: events.config.event,
      getConfiguration: vi.fn(),
    },
  };
});

vi.mock('vscode', () => ({
  EventEmitter: mock.Emitter,
  window: mock.window,
  workspace: mock.workspace,
  StatusBarAlignment: { Right: 2 },
  commands: {
    registerCommand: (id: string, callback: (...args: any[]) => any) => {
      mock.commands.set(id, callback);
      return { dispose: () => mock.commands.delete(id) };
    },
  },
}));

import { activate } from '../extension';
import { TerminalDetector } from '../terminalDetector';
import { ContextSender } from '../contextSender';
import { CLAUDE, CODEX } from '../providers';
import manifest from '../../package.json';

let subscriptions: { dispose(): void }[];
const terminal = (name: string, cwd = '/project') => ({
  name, creationOptions: { cwd }, sendText: vi.fn(), show: vi.fn(),
});
function detector(provider = CODEX) {
  const result = new TerminalDetector(provider);
  subscriptions.push(result);
  return result;
}
function selectEditor() {
  mock.window.activeTextEditor = {
    document: { uri: { fsPath: '/project/src/main.ts' } },
    selection: { isEmpty: false, start: { line: 9 }, end: { line: 19 } },
  };
}
function startExtension() {
  activate({ subscriptions } as any);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  subscriptions = [];
  mock.patterns = {};
  mock.commands.clear();
  mock.statusItems.length = 0;
  mock.window.terminals = [];
  mock.window.activeTerminal = undefined;
  mock.window.activeTextEditor = undefined;
  mock.workspace.workspaceFolders = [{ uri: { fsPath: '/project' } }];
  mock.workspace.getConfiguration.mockImplementation(() => ({
    get: (key: string, fallback: string[]) => mock.patterns[key] ?? fallback,
  }));
  mock.window.createStatusBarItem.mockImplementation(() => {
    const item = { text: '', command: '', tooltip: '', show: vi.fn(), hide: vi.fn(), dispose: vi.fn() };
    mock.statusItems.push(item);
    return item;
  });
});

afterEach(() => {
  for (const item of subscriptions) item.dispose();
  for (const event of Object.values(mock.events)) event.dispose();
  vi.useRealTimers();
});

describe('independent terminal targets', () => {
  it('keeps Claude and Codex separate while following active matching terminals', () => {
    const claude = terminal('Claude Code');
    const first = terminal('Codex one');
    const second = terminal('Codex two');
    mock.window.terminals = [claude, first, second];
    const claudeDetector = detector(CLAUDE);
    const codexDetector = detector();
    expect(codexDetector.target).toBe(first);
    mock.window.activeTerminal = second;
    mock.events.active.fire(second);
    expect(codexDetector.target).toBe(second);
    mock.window.activeTerminal = claude;
    mock.events.active.fire(claude);
    expect(codexDetector.target).toBe(second);
    expect(claudeDetector.target).toBe(claude);
    expect(codexDetector.getTerminals()).toEqual([first, second]);
  });

  it('pins a manually designated shell until it closes, then falls back', () => {
    const shell = terminal('zsh');
    const codex = terminal('Codex');
    mock.window.terminals = [shell, codex];
    const target = detector();
    target.designate(shell);
    mock.window.activeTerminal = codex;
    mock.events.active.fire(codex);
    expect(target.target).toBe(shell);
    expect(target.getTerminals()).toEqual([shell, codex]);
    mock.window.terminals = [codex];
    mock.events.close.fire(shell);
    expect(target.target).toBe(codex);
    mock.window.terminals = [];
    mock.window.activeTerminal = undefined;
    mock.events.close.fire(codex);
    expect(target.target).toBeUndefined();
  });

  it('refreshes matching when patterns change or a terminal is renamed', () => {
    const custom = terminal('assistant');
    mock.window.terminals = [custom];
    const target = detector();
    const changed = vi.fn();
    target.onDidChange(changed);
    expect(target.target).toBeUndefined();
    mock.patterns.codexTerminalNamePatterns = ['^assistant$'];
    mock.events.config.fire({ affectsConfiguration: (key: string) => key === 'autumnContextBridge.codexTerminalNamePatterns' });
    expect(changed).toHaveBeenCalled();
    expect(target.target).toBe(custom);
    mock.patterns.codexTerminalNamePatterns = [];
    mock.events.config.fire({ affectsConfiguration: () => true });
    expect(target.target).toBeUndefined();
    custom.name = 'Codex';
    expect(target.target).toBe(custom);
    custom.name = 'Claude Code';
    expect(target.target).toBeUndefined();
  });

  it('detects delayed titles even if another matching terminal already exists', () => {
    const first = terminal('Codex one');
    const second = terminal('zsh');
    mock.window.terminals = [first];
    const target = detector();
    mock.window.terminals.push(second);
    mock.window.activeTerminal = second;
    mock.events.open.fire(second);
    vi.advanceTimersByTime(2000);
    second.name = 'Codex two';
    // Observe polling via the event, without forcing a target scan until it fires.
    let observed: unknown;
    target.onDidChange(() => { observed = target.target; });
    vi.advanceTimersByTime(2000);
    expect(observed).toBe(second);
    vi.advanceTimersByTime(30000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('commands and context delivery', () => {
  it('registers every manifest command and routes each selection without pressing Enter', () => {
    const claude = terminal('Claude Code');
    const codex = terminal('Codex');
    mock.window.terminals = [claude, codex];
    mock.window.activeTerminal = claude;
    selectEditor();
    startExtension();
    expect([...mock.commands.keys()].sort()).toEqual(manifest.contributes.commands.map((c) => c.command).sort());
    mock.commands.get(CODEX.commands.sendSelection)!();
    expect(codex.sendText).toHaveBeenCalledOnce();
    expect(codex.sendText).toHaveBeenCalledWith(' src/main.ts:10-20 ', false);
    expect(codex.show).toHaveBeenCalledWith(false);
    expect(claude.sendText).not.toHaveBeenCalled();
    mock.commands.get(CLAUDE.commands.sendSelection)!();
    expect(claude.sendText).toHaveBeenCalledOnce();
    expect(claude.sendText).toHaveBeenCalledWith(' @src/main.ts:10-20 ', false);
  });

  it('sends multiple explorer files relative to shell integration cwd', () => {
    const codex = { ...terminal('Codex', '/wrong'), shellIntegration: { cwd: { fsPath: '/project/src' } } };
    mock.window.terminals = [codex];
    startExtension();
    const files = [{ fsPath: '/project/src/a b.ts' }, { fsPath: '/other/file.ts' }];
    mock.commands.get(CODEX.commands.addFiles)!(files[0], files);
    expect(codex.sendText).toHaveBeenCalledOnce();
    expect(codex.sendText).toHaveBeenCalledWith(' "a b.ts" /other/file.ts ', false);
  });

  it('falls back to the active editor file and creation cwd', () => {
    const codex = terminal('Codex');
    mock.window.terminals = [codex];
    selectEditor();
    startExtension();
    mock.commands.get(CODEX.commands.addFiles)!();
    expect(codex.sendText).toHaveBeenCalledWith(' src/main.ts ', false);
  });

  it('falls back to the first workspace, or absolute paths without a workspace', () => {
    const codex = { ...terminal('Codex'), creationOptions: {} };
    mock.window.terminals = [codex];
    const sender = new ContextSender(detector());
    sender.addFiles([{ fsPath: '/project/a.ts' }] as any);
    expect(codex.sendText).toHaveBeenLastCalledWith(' a.ts ', false);
    mock.workspace.workspaceFolders = [];
    sender.addFiles([{ fsPath: '/project/a.ts' }] as any);
    expect(codex.sendText).toHaveBeenLastCalledWith(' /project/a.ts ', false);
  });

  it('does not send to Claude when Codex is missing, or send an empty selection', () => {
    const claude = terminal('Claude Code');
    mock.window.terminals = [claude];
    selectEditor();
    startExtension();
    mock.commands.get(CODEX.commands.sendSelection)!();
    expect(claude.sendText).not.toHaveBeenCalled();
    expect(mock.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No Codex terminal found'));
    const codex = terminal('Codex');
    mock.window.terminals.push(codex);
    mock.window.activeTextEditor.selection.isEmpty = true;
    mock.commands.get(CODEX.commands.sendSelection)!();
    expect(codex.sendText).not.toHaveBeenCalled();
    expect(mock.window.showWarningMessage).toHaveBeenLastCalledWith('No text selected.');
  });

  it('pins a picked Codex terminal without changing the Claude target', async () => {
    const claude = terminal('Claude Code');
    const first = terminal('Codex one');
    const second = terminal('Codex two');
    mock.window.terminals = [claude, first, second];
    selectEditor();
    startExtension();
    mock.window.showQuickPick.mockImplementationOnce(async (items: any[]) => {
      expect(items.map((item) => item.terminal)).toEqual([first, second]);
      return items[1];
    });
    await mock.commands.get(CODEX.commands.selectTerminal)!();
    mock.window.activeTerminal = first;
    mock.events.active.fire(first);
    mock.commands.get(CODEX.commands.sendSelection)!();
    mock.commands.get(CLAUDE.commands.sendSelection)!();
    expect(second.sendText).toHaveBeenCalledOnce();
    expect(first.sendText).not.toHaveBeenCalled();
    expect(claude.sendText).toHaveBeenCalledOnce();
  });

  it('lets users designate a terminal whose title does not mention Codex', async () => {
    const shell = terminal('zsh');
    mock.window.terminals = [shell];
    mock.window.activeTerminal = shell;
    selectEditor();
    startExtension();
    await mock.commands.get(CODEX.commands.designate)!();
    mock.commands.get(CODEX.commands.sendSelection)!();
    expect(shell.sendText).toHaveBeenCalledWith(' src/main.ts:10-20 ', false);
  });

  it('shows separate status actions and hides the Codex item when its target closes', () => {
    const claude = terminal('Claude Code');
    const codex = terminal('Codex');
    mock.window.terminals = [claude, codex];
    selectEditor();
    startExtension();
    const [claudeItem, codexItem] = mock.statusItems;
    expect(claudeItem.command).toBe(CLAUDE.commands.sendSelection);
    expect(codexItem.command).toBe(CODEX.commands.sendSelection);
    expect(codexItem.text).toBe('$(terminal) Codex $(selection)');
    expect(codexItem.show).toHaveBeenCalled();
    mock.window.activeTextEditor.selection.isEmpty = true;
    mock.events.selection.fire();
    expect(codexItem.text).toBe('$(terminal) Codex');
    mock.window.terminals = [claude];
    mock.events.close.fire(codex);
    expect(codexItem.hide).toHaveBeenCalled();
    expect(claudeItem.text).toBe('$(terminal) Claude Code');
  });
});
