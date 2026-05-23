import * as vscode from 'vscode';
import { TranscriptionPanelController } from './controllers/TranscriptionPanelController';
import { MockAudioService } from './services/AudioService';
import { VsCodeFileSystemService } from './services/FileSystemService';

let transcriptionPanelController: TranscriptionPanelController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  transcriptionPanelController = new TranscriptionPanelController(
    context,
    new MockAudioService(),
    new VsCodeFileSystemService(context)
  );

  await transcriptionPanelController.initialize();

  const openUiCommand = vscode.commands.registerCommand(
    'vscode-whisper-lite.openTranscriptions',
    () => {
      transcriptionPanelController?.open();
    }
  );

  context.subscriptions.push(openUiCommand, transcriptionPanelController);
}

export function deactivate() {
  transcriptionPanelController?.dispose();
}
