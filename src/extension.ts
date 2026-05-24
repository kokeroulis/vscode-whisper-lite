import * as vscode from 'vscode';
import { TranscriptionPanelController } from './controllers/TranscriptionPanelController';
import { NativeAudioService } from './services/AudioService';
import { GithubReleaseDownloadModelService } from './services/DownloadModelService';
import { VsCodeFileSystemService } from './services/FileSystemService';
import { WhisperCliTranscriptionService } from './services/TranscriptionService';

let transcriptionPanelController: TranscriptionPanelController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const downloadModelService = new GithubReleaseDownloadModelService(context);

  transcriptionPanelController = new TranscriptionPanelController(
    context,
    new NativeAudioService(context),
    new WhisperCliTranscriptionService(context, downloadModelService),
    new VsCodeFileSystemService(context),
    downloadModelService
  );

  await transcriptionPanelController.initialize();

  const openUiCommand = vscode.commands.registerCommand(
    'vscode-whisper-lite.openTranscriptions',
    (): void => {
      void transcriptionPanelController?.open();
    }
  );
  const panelSerializer = vscode.window.registerWebviewPanelSerializer(
    'whisperLiteTranscriptions',
    {
      async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel): Promise<void> {
        await transcriptionPanelController?.restore(webviewPanel);
      }
    }
  );

  context.subscriptions.push(openUiCommand, panelSerializer, transcriptionPanelController);
}

export function deactivate(): void {
  transcriptionPanelController?.dispose();
}
