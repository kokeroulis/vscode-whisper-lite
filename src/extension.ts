import * as vscode from 'vscode';
import { TranscriptionPanelController } from './controllers/TranscriptionPanelController';
import { NativeAudioService } from './services/AudioService';
import { VsCodeFileSystemService } from './services/FileSystemService';
import { WhisperCliTranscriptionService } from './services/TranscriptionService';

let transcriptionPanelController: TranscriptionPanelController | undefined;

export async function activate(context: vscode.ExtensionContext) {
  transcriptionPanelController = new TranscriptionPanelController(
    context,
    new NativeAudioService(context),
    new WhisperCliTranscriptionService(context),
    new VsCodeFileSystemService(context)
  );

  await transcriptionPanelController.initialize();

  const openUiCommand = vscode.commands.registerCommand(
    'vscode-whisper-lite.openTranscriptions',
    () => {
      void transcriptionPanelController?.open();
    }
  );
  const panelSerializer = vscode.window.registerWebviewPanelSerializer(
    'whisperLiteTranscriptions',
    {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel) {
        await transcriptionPanelController?.restore(webviewPanel);
      }
    }
  );

  context.subscriptions.push(openUiCommand, panelSerializer, transcriptionPanelController);
}

export function deactivate() {
  transcriptionPanelController?.dispose();
}
