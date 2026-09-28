import * as vscode from 'vscode';
import { TerminalDetector } from './terminalDetector';
import { ContextSender } from './contextSender';
import { StatusBar } from './statusBar';
import { CLAUDE, CODEX, Provider } from './providers';
import { AgentManager } from './agentManager';

export function activate(context: vscode.ExtensionContext) {
  for (const provider of [CLAUDE, CODEX]) {
    registerProvider(context, provider);
  }
  context.subscriptions.push(new AgentManager());
}

function registerProvider(context: vscode.ExtensionContext, provider: Provider): void {
  const detector = new TerminalDetector(provider);
  const sender = new ContextSender(detector);
  const statusBar = new StatusBar(detector);

  context.subscriptions.push(detector, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      provider.commands.addFiles,
      (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
        // When invoked from explorer context menu, `uri` is the right-clicked
        // item and `uris` is all selected items (if multi-select).
        // When invoked from editor title context or keybinding, fall back to active editor.
        const targets =
          uris && uris.length > 0
            ? uris
            : uri
              ? [uri]
              : vscode.window.activeTextEditor
                ? [vscode.window.activeTextEditor.document.uri]
                : [];

        if (targets.length === 0) {
          vscode.window.showWarningMessage('No file to add.');
          return;
        }
        sender.addFiles(targets);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      provider.commands.sendSelection,
      () => {
        sender.sendSelection();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      provider.commands.designate,
      async () => {
        const active = vscode.window.activeTerminal;
        const terminals = vscode.window.terminals;

        if (terminals.length === 0) {
          vscode.window.showWarningMessage('No terminals open.');
          return;
        }

        // If there's a focused terminal, offer to designate it directly
        if (terminals.length === 1 && active) {
          detector.designate(active);
          vscode.window.showInformationMessage(
            `"${active.name}" set as ${provider.name} terminal.`,
          );
          return;
        }

        const items = terminals.map((t) => ({
          label: t.name,
          terminal: t,
          description: t === active ? '(active)' : undefined,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Select terminal to designate as ${provider.name}`,
        });

        if (picked) {
          detector.designate(picked.terminal);
          vscode.window.showInformationMessage(
            `"${picked.terminal.name}" set as ${provider.name} terminal.`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      provider.commands.selectTerminal,
      async () => {
        const matchingTerminals = detector.getTerminals();

        if (matchingTerminals.length === 0) {
          vscode.window.showWarningMessage(
            `No ${provider.name} terminals found.`,
          );
          return;
        }

        if (matchingTerminals.length === 1) {
          detector.designate(matchingTerminals[0]);
          vscode.window.showInformationMessage(
            `Only one ${provider.name} terminal: "${matchingTerminals[0].name}"`,
          );
          return;
        }

        const items = matchingTerminals.map((t) => ({
          label: t.name,
          terminal: t,
          description: t === detector.target ? '(current target)' : undefined,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: `Select which ${provider.name} terminal to target`,
        });

        if (picked) {
          detector.designate(picked.terminal);
        }
      },
    ),
  );
}

export function deactivate() {}
