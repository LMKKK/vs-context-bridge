import * as vscode from 'vscode';
import { CLAUDE, Provider } from './providers';

const POLL_INTERVAL_MS = 2000;
const POLL_DURATION_MS = 30000;

export class TerminalDetector implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private disposables: vscode.Disposable[] = [];
  private designatedTerminal: vscode.Terminal | undefined;
  private activeMatchingTerminal: vscode.Terminal | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor(readonly provider: Provider = CLAUDE) {
    this.disposables.push(
      vscode.window.onDidOpenTerminal(() => this.onTerminalOpened()),
      vscode.window.onDidCloseTerminal((t) => this.onTerminalClosed(t)),
      vscode.window.onDidChangeActiveTerminal(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`autumnContextBridge.${this.provider.patternsSetting}`)) {
          this.refresh();
        }
      }),
      this._onDidChange,
    );
    this.refresh();
  }

  get target(): vscode.Terminal | undefined {
    // Always re-scan fresh so we pick up name changes
    this.scanForTarget();
    if (this.designatedTerminal) {
      return this.designatedTerminal;
    }
    return this.activeMatchingTerminal;
  }

  get hasTarget(): boolean {
    return this.target !== undefined;
  }

  designate(terminal: vscode.Terminal): void {
    this.designatedTerminal = terminal;
    this._onDidChange.fire();
  }

  clearDesignation(): void {
    this.designatedTerminal = undefined;
    this.refresh();
  }

  getTerminals(): vscode.Terminal[] {
    return vscode.window.terminals.filter(
      (t) => t === this.designatedTerminal || this.isMatchingTerminal(t),
    );
  }

  private isMatchingTerminal(terminal: vscode.Terminal): boolean {
    const config = vscode.workspace.getConfiguration('autumnContextBridge');
    const customPatterns: string[] = config.get(this.provider.patternsSetting, []);
    return this.provider.matchesTerminalName(terminal.name, customPatterns);
  }

  private scanForTarget(): void {
    const active = vscode.window.activeTerminal;
    if (active && (active === this.designatedTerminal || this.isMatchingTerminal(active))) {
      this.activeMatchingTerminal = active;
    }

    const terminals = vscode.window.terminals;
    if (this.activeMatchingTerminal && (
      !terminals.includes(this.activeMatchingTerminal) ||
      !this.isMatchingTerminal(this.activeMatchingTerminal)
    )) {
      this.activeMatchingTerminal = terminals.find((t) => this.isMatchingTerminal(t));
    }

    if (!this.activeMatchingTerminal) {
      this.activeMatchingTerminal = terminals.find((t) => this.isMatchingTerminal(t));
    }
  }

  private refresh(): void {
    this.scanForTarget();
    this._onDidChange.fire();
  }

  private onTerminalOpened(): void {
    this.refresh();
    // Terminal name may be empty at open time (CLIs can set their title
    // asynchronously). Poll for a while to catch the name change.
    this.startPolling();
  }

  private startPolling(): void {
    this.stopPolling();
    let elapsed = 0;
    this.pollTimer = setInterval(() => {
      elapsed += POLL_INTERVAL_MS;
      this.refresh();
      if (elapsed >= POLL_DURATION_MS) {
        this.stopPolling();
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private onTerminalClosed(terminal: vscode.Terminal): void {
    if (terminal === this.designatedTerminal) {
      this.designatedTerminal = undefined;
    }
    if (terminal === this.activeMatchingTerminal) {
      this.activeMatchingTerminal = undefined;
    }
    this.refresh();
  }

  dispose(): void {
    this.stopPolling();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
