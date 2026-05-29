import * as vscode from 'vscode';
import { AudioService, TemporaryAudioFile } from '../services/AudioService';
import {
  DownloadModelService,
  ModelCatalogState,
  ModelDownloadProgress,
  WhisperModelId
} from '../services/DownloadModelService';
import { FileSystemService } from '../services/FileSystemService';
import { LoggerService, NoopLoggerService } from '../services/LoggerService';
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
    private readonly logger: LoggerService = new NoopLoggerService(),
    private readonly transcriptionWebView: TranscriptionWebView = new TranscriptionWebView()
  ) {}

  async initialize(): Promise<void> {
    this.logger.info('Initializing Whisper Lite extension.');
    await this.fileSystemService.clearTemporaryAudioFiles();
    this.transcriptions = await this.fileSystemService.loadTranscriptions();
    this.logger.info(`Loaded ${this.transcriptions.length} saved transcription records.`);
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
    const styleUri = webviewPanel.webview
      .asWebviewUri(vscode.Uri.file(this.transcriptionWebView.getStylesheetPath()))
      .toString();
    const scriptUri = webviewPanel.webview
      .asWebviewUri(vscode.Uri.file(this.transcriptionWebView.getClientScriptPath()))
      .toString();
    webviewPanel.webview.html = this.transcriptionWebView.renderForWebview(
      webviewPanel.webview,
      styleUri,
      scriptUri
    );
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
    if (!(await this.hasUsableSelectedModel())) {
      this.logger.warn('Transcription was requested without a downloaded selected model.');
      await this.postStateToWebview();
      void vscode.window.showWarningMessage('Download and select a model before transcribing.');
      return;
    }

    const temporaryAudioFile = this.fileSystemService.createTemporaryAudioFile('audio/wav');

    try {
      this.logger.info('Starting transcription workflow.');
      await this.audioService.startRecording(temporaryAudioFile);
      this.recordingStartedAt = Date.now();
      await this.postStateToWebview();
    } catch (error) {
      this.logger.error('Could not start transcription workflow.', error);
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
    let temporaryAudioFile: TemporaryAudioFile | undefined;

    try {
      this.logger.info('Stopping transcription workflow.');
      const audioFilePromise = this.audioService.stopRecording();

      await this.postStateToWebview();

      temporaryAudioFile = await audioFilePromise;

      if (!temporaryAudioFile) {
        this.logger.warn('Stop transcription requested, but no audio file was returned.');
        await this.postStateToWebview();
        return;
      }

      if (this.audioService.getWorkflowState() !== 'translating') {
        this.logger.info('Skipping transcription because the workflow was canceled.');
        return;
      }

      this.logger.info(`Audio recording ready at ${temporaryAudioFile.path}.`);
      this.audioService.markTranslating();
      await this.postStateToWebview();

      if (this.audioService.getWorkflowState() !== 'translating') {
        this.logger.info('Skipping transcription because the workflow was canceled.');
        return;
      }

      const transcription = await this.transcriptionService.transcribeAudio(
        temporaryAudioFile,
        startedAt,
        stopStartedAt
      );

      this.transcriptions = [transcription, ...this.transcriptions];
      this.logger.info(`Transcription finished with id ${transcription.id}.`);
      await this.saveAndRender();
    } catch (error) {
      this.logger.error('Could not stop or transcribe recording.', error);
      await vscode.window.showErrorMessage(`Could not transcribe audio: ${getErrorMessage(error)}`);
    } finally {
      this.recordingStartedAt = undefined;
      this.audioService.markIdle();
      if (temporaryAudioFile) {
        await this.fileSystemService.deleteTemporaryAudioFile(temporaryAudioFile);
      }
      await this.postStateToWebview();
    }
  }

  private cancelTranscription(): void {
    this.logger.warn('Canceling transcription workflow.');
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
      this.logger.error('Could not download model.', error);
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
      this.logger.error('Could not select model.', error);
      await vscode.window.showWarningMessage(getErrorMessage(error));
      await this.postStateToWebview();
    }
  }

  private async postStateToWebview(progress?: ModelDownloadProgress): Promise<void> {
    if (!this.panel) {
      return;
    }

    await this.panel.webview.postMessage(await this.createState(progress));
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

  private async hasUsableSelectedModel(): Promise<boolean> {
    const modelCatalog = await this.downloadModelService.getModelCatalogState();

    return modelCatalog.models.some((model) => model.selected && model.installed);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
