import * as vscode from 'vscode';
import { AGENT_COMMANDS, OMP, parseCustomAgents } from './agentConfig';
import { ContextSender } from './contextSender';
import { Provider } from './providers';
import { TerminalDetector } from './terminalDetector';

interface AgentRuntime {
  provider: Provider;
  detector: TerminalDetector;
  sender: ContextSender;
  changeListener: vscode.Disposable;
}

export class AgentManager implements vscode.Disposable {
  private readonly runtimes = new Map<string, AgentRuntime>();
  private readonly configSignatures = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusItem: vscode.StatusBarItem;
  private selectedId = OMP.id;

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 48);
    this.statusItem.command = AGENT_COMMANDS.sendSelection;
    this.disposables.push(
      this.statusItem,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('autumnContextBridge.agents')) this.reload();
      }),
      vscode.window.onDidChangeTextEditorSelection(() => this.updateStatus()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateStatus()),
      vscode.commands.registerCommand(AGENT_COMMANDS.addFiles, (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
        this.addFiles(uri, uris)),
      vscode.commands.registerCommand(AGENT_COMMANDS.sendSelection, () => this.sendSelection()),
      vscode.commands.registerCommand(AGENT_COMMANDS.designate, () => this.designate()),
      vscode.commands.registerCommand(AGENT_COMMANDS.selectTerminal, () => this.selectTerminal()),
    );
    this.reload();
  }

  private reload(): void {
    const configured = vscode.workspace.getConfiguration('autumnContextBridge').get<unknown>('agents', []);
    const { providers, errors } = parseCustomAgents(configured);
    const nextSignatures = new Map<string, string>();
    for (const provider of providers) {
      const entry = (configured as Array<{ id?: unknown } | null>).find((item) => item?.id === provider.id);
      nextSignatures.set(provider.id, JSON.stringify(entry));
    }
    for (const [id, runtime] of this.runtimes) {
      if (id === OMP.id) continue;
      if (this.configSignatures.get(id) === nextSignatures.get(id)) continue;
      runtime.changeListener.dispose();
      runtime.detector.dispose();
      this.runtimes.delete(id);
    }
    this.configSignatures.clear();
    for (const [id, signature] of nextSignatures) this.configSignatures.set(id, signature);
    for (const provider of [OMP, ...providers]) {
      if (this.runtimes.has(provider.id)) continue;
      const detector = new TerminalDetector(provider);
      this.runtimes.set(provider.id, {
        provider,
        detector,
        sender: new ContextSender(detector),
        changeListener: detector.onDidChange(() => this.updateStatus()),
      });
    }
    if (!this.runtimes.has(this.selectedId)) this.selectedId = OMP.id;
    if (errors.length) {
      vscode.window.showWarningMessage(`Invalid Agent configuration: ${errors.join(' ')}`);
    }
    this.updateStatus();
  }

  private async pickAgent(): Promise<AgentRuntime | undefined> {
    const runtimes = [...this.runtimes.values()];
    runtimes.sort((a, b) => Number(b.provider.id === this.selectedId) - Number(a.provider.id === this.selectedId));
    const items = runtimes.map((runtime) => ({
      label: runtime.provider.name,
      description: runtime.provider.id === this.selectedId ? '(last used)' : undefined,
      runtime,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an Agent',
    });
    if (!picked) return undefined;
    this.selectedId = picked.runtime.provider.id;
    this.updateStatus();
    return picked.runtime;
  }

  private async addFiles(uri?: vscode.Uri, uris?: vscode.Uri[]): Promise<void> {
    const targets = uris && uris.length > 0
      ? uris
      : uri
        ? [uri]
        : vscode.window.activeTextEditor
          ? [vscode.window.activeTextEditor.document.uri]
          : [];
    if (!targets.length) {
      vscode.window.showWarningMessage('No file to add.');
      return;
    }
    const runtime = await this.pickAgent();
    runtime?.sender.addFiles(targets);
  }

  private async sendSelection(): Promise<void> {
    if (!vscode.window.activeTextEditor || vscode.window.activeTextEditor.selection.isEmpty) {
      vscode.window.showWarningMessage('No text selected.');
      return;
    }
    const runtime = await this.pickAgent();
    runtime?.sender.sendSelection();
  }

  private async designate(): Promise<void> {
    const runtime = await this.pickAgent();
    if (!runtime) return;
    const terminals = vscode.window.terminals;
    if (!terminals.length) {
      vscode.window.showWarningMessage('No terminals open.');
      return;
    }
    const active = vscode.window.activeTerminal;
    let target: vscode.Terminal | undefined;
    if (terminals.length === 1 && active) {
      target = active;
    } else {
      const picked = await vscode.window.showQuickPick(terminals.map((terminal) => ({
        label: terminal.name,
        description: terminal === active ? '(active)' : undefined,
        terminal,
      })), { placeHolder: `Select terminal to designate as ${runtime.provider.name}` });
      target = picked?.terminal;
    }
    if (target) {
      runtime.detector.designate(target);
      vscode.window.showInformationMessage(`"${target.name}" set as ${runtime.provider.name} terminal.`);
    }
  }

  private async selectTerminal(): Promise<void> {
    const runtime = await this.pickAgent();
    if (!runtime) return;
    const terminals = runtime.detector.getTerminals();
    if (!terminals.length) {
      vscode.window.showWarningMessage(`No ${runtime.provider.name} terminals found.`);
      return;
    }
    if (terminals.length === 1) {
      runtime.detector.designate(terminals[0]);
      return;
    }
    const picked = await vscode.window.showQuickPick(terminals.map((terminal) => ({
      label: terminal.name,
      description: terminal === runtime.detector.target ? '(current target)' : undefined,
      terminal,
    })), { placeHolder: `Select which ${runtime.provider.name} terminal to target` });
    if (picked) runtime.detector.designate(picked.terminal);
  }

  private updateStatus(): void {
    const runtime = this.runtimes.get(this.selectedId);
    const target = runtime?.detector.target;
    if (!runtime || !target) {
      this.statusItem.hide();
      return;
    }
    const hasSelection = !!vscode.window.activeTextEditor && !vscode.window.activeTextEditor.selection.isEmpty;
    this.statusItem.text = `$(terminal) ${runtime.provider.name}${hasSelection ? ' $(selection)' : ''}`;
    this.statusItem.tooltip = `Send selection to Agent (last used: ${runtime.provider.name}; target: ${target.name})`;
    this.statusItem.show();
  }

  dispose(): void {
    for (const runtime of this.runtimes.values()) {
      runtime.changeListener.dispose();
      runtime.detector.dispose();
    }
    for (const disposable of this.disposables) disposable.dispose();
  }
}
