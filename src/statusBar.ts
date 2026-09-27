import * as vscode from 'vscode';
import { TerminalDetector } from './terminalDetector';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly detector: TerminalDetector) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      detector.provider.statusBarPriority,
    );
    this.item.command = detector.provider.commands.sendSelection;

    this.disposables.push(
      this.item,
      detector.onDidChange(() => this.update()),
      vscode.window.onDidChangeTextEditorSelection(() => this.update()),
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
    );

    this.update();
  }

  private update(): void {
    const target = this.detector.target;
    if (!target) {
      this.item.hide();
      return;
    }

    const hasSelection =
      vscode.window.activeTextEditor !== undefined &&
      !vscode.window.activeTextEditor.selection.isEmpty;

    if (hasSelection) {
      this.item.text = `$(terminal) ${this.detector.provider.name} $(selection)`;
      this.item.tooltip = `Send selection to ${this.detector.provider.name}: ${target.name}`;
    } else {
      this.item.text = `$(terminal) ${this.detector.provider.name}`;
      this.item.tooltip = `${this.detector.provider.name} target: ${target.name}`;
    }

    this.item.show();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
