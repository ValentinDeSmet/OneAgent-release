import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = "$(database) Work Memory";
  status.command = "workMemory.showContext";
  status.show();

  context.subscriptions.push(
    status,
    vscode.commands.registerCommand("workMemory.showContext", async () => {
      await vscode.window.showInformationMessage("Work Memory context command scaffold is ready.");
    }),
    vscode.commands.registerCommand("workMemory.ingestSource", async () => {
      await vscode.window.showInformationMessage("Work Memory source ingestion will call the local CLI in the next milestone.");
    }),
    vscode.commands.registerCommand("workMemory.openInbox", async () => {
      await vscode.window.showInformationMessage("Work Memory inbox view scaffold is ready.");
    })
  );
}

export function deactivate(): void {}
