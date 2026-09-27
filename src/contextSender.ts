import * as vscode from 'vscode';
import { TerminalDetector } from './terminalDetector';
import { toRelativePath } from './matching';

export class ContextSender {
  constructor(private readonly detector: TerminalDetector) {}

  addFiles(uris: vscode.Uri[]): void {
    const terminal = this.requireTerminal();
    if (!terminal) return;

    const workspacePaths = this.getTerminalWorkspacePaths(terminal);
    const refs = uris
      .map((uri) => this.detector.provider.formatFileRef(toRelativePath(uri.fsPath, workspacePaths)))
      .join(' ');
    terminal.sendText(' ' + refs + ' ', false);
    terminal.show(false);
  }

  sendSelection(): void {
    const terminal = this.requireTerminal();
    if (!terminal) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage('No text selected.');
      return;
    }

    const sel = editor.selection;
    const workspacePaths = this.getTerminalWorkspacePaths(terminal);
    const filePath = toRelativePath(editor.document.uri.fsPath, workspacePaths);
    const startLine = sel.start.line + 1;
    const endLine = sel.end.line + 1;

    const ref = this.detector.provider.formatSelectionRef(filePath, startLine, endLine);
    terminal.sendText(' ' + ref + ' ', false);
    terminal.show(false);
  }

  private getTerminalCwd(terminal: vscode.Terminal): string | undefined {
    // Shell integration (VS Code 1.93+) — most accurate, tracks cd
    const si = (terminal as any).shellIntegration;
    if (si?.cwd) {
      return si.cwd.fsPath ?? String(si.cwd);
    }
    // Creation options — initial CWD set when terminal was opened
    const opts = terminal.creationOptions;
    if ('cwd' in opts && opts.cwd) {
      return typeof opts.cwd === 'string'
        ? opts.cwd
        : (opts.cwd as vscode.Uri).fsPath;
    }
    return undefined;
  }

  private getTerminalWorkspacePaths(terminal: vscode.Terminal): string[] {
    const cwd = this.getTerminalCwd(terminal);
    if (cwd) return [cwd];
    // Fallback: first workspace folder only (most likely the CLI's root)
    const first = vscode.workspace.workspaceFolders?.[0];
    return first ? [first.uri.fsPath] : [];
  }

  private requireTerminal(): vscode.Terminal | undefined {
    const terminal = this.detector.target;
    if (!terminal) {
      vscode.window.showWarningMessage(
        `No ${this.detector.provider.name} terminal found. Open one first or use "Set as ${this.detector.provider.name} Terminal".`,
      );
    }
    return terminal;
  }
}
