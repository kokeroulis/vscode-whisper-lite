import * as vscode from 'vscode';
import { AudioService } from '../services/AudioService';
import {
  DownloadModelService,
  ModelCatalogState,
  ModelDownloadProgress,
  WhisperModelId
} from '../services/DownloadModelService';
import { FileSystemService } from '../services/FileSystemService';
import { Transcription, TranscriptionService } from '../services/TranscriptionService';
import { TranscriptionWebView } from '../views/TranscriptionWebView';

export type WebviewMessage =
  | { type: 'webviewReady' }
  | { type: 'startTranscription' }
  | { type: 'stopTranscription' }
  | { type: 'cancelTranscription' }
  | { type: 'copyTranscription'; id: string }
  | { type: 'deleteTranscription'; id: string }
  | { type: 'downloadModel'; modelId: WhisperModelId }
  | { type: 'selectModel'; modelId: WhisperModelId };

export type TranscriptionPanelState = {
  type: 'state';
  transcriptions: Transcription[];
  workflowState: ReturnType<AudioService['getWorkflowState']>;
  isUiBlocked: boolean;
  modelCatalog: ModelCatalogState;
};

export class TranscriptionPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private transcriptions: Transcription[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private recordingStartedAt: number | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly audioService: AudioService,
    private readonly transcriptionService: TranscriptionService,
    private readonly fileSystemService: FileSystemService,
    private readonly downloadModelService: DownloadModelService,
    private readonly transcriptionWebView: TranscriptionWebView = new TranscriptionWebView()
  ) {}

  async initialize(): Promise<void> {
    await this.fileSystemService.clearTemporaryAudioFiles();
    this.transcriptions = await this.fileSystemService.loadTranscriptions();
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      await this.reloadTranscriptions();
      await this.postStateToWebview();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'whisperLiteTranscriptions',
      'Whisper Lite',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.configurePanel(this.panel);
    await this.reloadTranscriptions();
    await this.postStateToWebview();
  }

  async restore(webviewPanel: vscode.WebviewPanel): Promise<void> {
    this.panel = webviewPanel;
    this.configurePanel(webviewPanel);
    await this.reloadTranscriptions();
    await this.postStateToWebview();
  }

  private async reloadTranscriptions(): Promise<void> {
    this.transcriptions = await this.fileSystemService.loadTranscriptions();
  }

  private configurePanel(webviewPanel: vscode.WebviewPanel): void {
    webviewPanel.webview.options = {
      enableScripts: true
    };
    webviewPanel.webview.html = this.transcriptionWebView.renderForWebview(webviewPanel.webview);
    this.disposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleWebviewMessage(message);
      }),
      webviewPanel.onDidDispose(() => {
        if (this.panel === webviewPanel) {
          this.panel = undefined;
        }
      })
    );
  }

  dispose(): void {
    this.audioService.dispose();
    this.transcriptionService.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
  }

  async handleTestMessage(message: WebviewMessage): Promise<void> {
    await this.handleWebviewMessage(message);
  }

  async getStateForTesting(): Promise<TranscriptionPanelState> {
    return this.createState();
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'webviewReady':
        await this.postStateToWebview();
        return;

      case 'startTranscription':
        await this.startTranscription();
        return;

      case 'stopTranscription':
        await this.stopTranscription();
        return;

      case 'cancelTranscription':
        this.cancelTranscription();
        return;

      case 'copyTranscription':
        await this.copyTranscription(message.id);
        return;

      case 'deleteTranscription':
        await this.deleteTranscription(message.id);
        return;

      case 'downloadModel':
        await this.downloadModel(message.modelId);
        return;

      case 'selectModel':
        await this.selectModel(message.modelId);
        return;
    }
  }

  private async startTranscription(): Promise<void> {
    const temporaryAudioFile = this.fileSystemService.createTemporaryAudioFile('audio/wav');

    try {
      await this.audioService.startRecording(temporaryAudioFile);
      this.recordingStartedAt = Date.now();
      await this.postStateToWebview();
    } catch (error) {
      await this.fileSystemService.deleteTemporaryAudioFile(temporaryAudioFile);
      await this.postStateToWebview();
      await vscode.window.showErrorMessage(
        `Could not start microphone recording: ${getErrorMessage(error)}`
      );
    }
  }

  private async stopTranscription(): Promise<void> {
    const stopStartedAt = Date.now();
    const startedAt = this.recordingStartedAt ?? stopStartedAt;
    const audioFilePromise = this.audioService.stopRecording();

    await this.postStateToWebview();

    const temporaryAudioFile = await audioFilePromise;

    if (!temporaryAudioFile) {
      await this.postStateToWebview();
      return;
    }

    try {
      this.audioService.markTranslating();
      await this.postStateToWebview();

      const transcription = await this.transcriptionService.transcribeAudio(
        temporaryAudioFile,
        startedAt,
        stopStartedAt
      );

      this.transcriptions = [transcription, ...this.transcriptions];
      await this.saveAndRender();
    } finally {
      this.recordingStartedAt = undefined;
      this.audioService.markIdle();
      await this.fileSystemService.deleteTemporaryAudioFile(temporaryAudioFile);
      await this.postStateToWebview();
    }
  }

  private cancelTranscription(): void {
    this.audioService.cancelRecording();
    this.transcriptionService.cancelTranscription();
    this.audioService.markIdle();
    this.recordingStartedAt = undefined;
    void this.postStateToWebview();
  }

  private async copyTranscription(id: string): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    const transcription = this.transcriptions.find((item) => item.id === id);

    if (!transcription) {
      await vscode.window.showWarningMessage('That transcription no longer exists.');
      return;
    }

    await vscode.env.clipboard.writeText(transcription.content);
    await vscode.window.showInformationMessage('Transcription copied to clipboard.');
  }

  private async deleteTranscription(id: string): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    this.transcriptions = this.transcriptions.filter((item) => item.id !== id);
    await this.saveAndRender();
  }

  private async saveAndRender(): Promise<void> {
    await this.fileSystemService.saveTranscriptions(this.transcriptions);
    await this.postStateToWebview();
  }

  private async downloadModel(modelId: WhisperModelId): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    try {
      await this.downloadModelService.downloadModel(
        modelId,
        (progress: ModelDownloadProgress): void => {
          void this.postStateToWebview(progress);
        }
      );
      await this.postStateToWebview();
    } catch (error) {
      await this.postStateToWebview();
      await vscode.window.showErrorMessage(`Could not download model: ${getErrorMessage(error)}`);
    }
  }

  private async selectModel(modelId: WhisperModelId): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    try {
      await this.downloadModelService.selectModel(modelId);
      await this.postStateToWebview();
    } catch (error) {
      await vscode.window.showWarningMessage(getErrorMessage(error));
      await this.postStateToWebview();
    }
  }

  private async postStateToWebview(progress?: ModelDownloadProgress): Promise<void> {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage(await this.createState(progress));
  }

  private async createState(progress?: ModelDownloadProgress): Promise<TranscriptionPanelState> {
    const modelCatalog = await this.downloadModelService.getModelCatalogState();

    return {
      type: 'state',
      transcriptions: this.transcriptions,
      workflowState: this.audioService.getWorkflowState(),
      isUiBlocked: this.isUiBlocked(),
      modelCatalog: progress
        ? {
            ...modelCatalog,
            models: modelCatalog.models.map((model) =>
              model.id === progress.modelId
                ? {
                    ...model,
                    status: 'downloading',
                    progress
                  }
                : model
            )
          }
        : modelCatalog
    };
  }

  private isUiBlocked(): boolean {
    return this.audioService.getWorkflowState() === 'translating';
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
