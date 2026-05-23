import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const startTranscriptionCommand = vscode.commands.registerCommand(
    'vscode-whisper-lite.startTranscription',
    async () => {
      await vscode.window.showInformationMessage(
        'Whisper Lite is ready. Whisper.cpp transcription will be added in a future step.'
      );
    }
  );

  context.subscriptions.push(startTranscriptionCommand);
}

export function deactivate() {}
