import * as vscode from 'vscode';
import {
  TranscriptionPanelController,
  TranscriptionPanelState
} from './controllers/TranscriptionPanelController';
import {
  AudioService,
  NativeAudioService,
  TemporaryAudioFile,
  TranscriptionWorkflowState
} from './services/AudioService';
import { GithubReleaseDownloadModelService } from './services/DownloadModelService';
import { VsCodeFileSystemService } from './services/FileSystemService';
import { VsCodeLoggerService } from './services/LoggerService';
import {
  Transcription,
  TranscriptionService,
  WhisperCliTranscriptionService
} from './services/TranscriptionService';

let transcriptionPanelController: TranscriptionPanelController | undefined;
const smokeTestEnv = 'VSCODE_WHISPER_LITE_SMOKE_TEST';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new VsCodeLoggerService(vscode.window.createOutputChannel('Whisper Lite'));
  const downloadModelService = new GithubReleaseDownloadModelService(context, logger);
  const audioService = createAudioService(context, logger);

  transcriptionPanelController = new TranscriptionPanelController(
    context,
    audioService,
    createTranscriptionService(context, downloadModelService, logger),
    new VsCodeFileSystemService(context, logger),
    downloadModelService,
    logger
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

  if (isSmokeTestEnabled()) {
    registerSmokeTestCommands(context);
  }

  context.subscriptions.push(logger, openUiCommand, panelSerializer, transcriptionPanelController);
}

export function deactivate(): void {
  transcriptionPanelController?.dispose();
}

function createAudioService(
  context: vscode.ExtensionContext,
  logger: VsCodeLoggerService
): AudioService {
  return isSmokeTestEnabled() ? new SmokeTestAudioService() : new NativeAudioService(context, logger);
}

function createTranscriptionService(
  context: vscode.ExtensionContext,
  downloadModelService: GithubReleaseDownloadModelService,
  logger: VsCodeLoggerService
): TranscriptionService {
  return isSmokeTestEnabled()
    ? new SmokeTestTranscriptionService()
    : new WhisperCliTranscriptionService(context, downloadModelService, logger);
}

function isSmokeTestEnabled(): boolean {
  return process.env[smokeTestEnv] === '1';
}

function registerSmokeTestCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-whisper-lite.test.startTranscription', () =>
      transcriptionPanelController?.handleTestMessage({ type: 'startTranscription' })
    ),
    vscode.commands.registerCommand('vscode-whisper-lite.test.stopTranscription', () => {
      void transcriptionPanelController?.handleTestMessage({ type: 'stopTranscription' });
    }),
    vscode.commands.registerCommand('vscode-whisper-lite.test.cancelTranscription', () =>
      transcriptionPanelController?.handleTestMessage({ type: 'cancelTranscription' })
    ),
    vscode.commands.registerCommand('vscode-whisper-lite.test.downloadModel', () =>
      transcriptionPanelController?.handleTestMessage({
        type: 'downloadModel',
        modelId: 'medium.en'
      })
    ),
    vscode.commands.registerCommand(
      'vscode-whisper-lite.test.getState',
      (): Promise<TranscriptionPanelState | undefined> =>
        transcriptionPanelController?.getStateForTesting() ?? Promise.resolve(undefined)
    )
  );
}

class SmokeTestAudioService implements AudioService {
  private workflowState: TranscriptionWorkflowState = 'idle';
  private audioFile: TemporaryAudioFile | undefined;

  startRecording(audioFile: TemporaryAudioFile): Promise<void> {
    this.audioFile = audioFile;
    this.workflowState = 'recording';

    return Promise.resolve();
  }

  stopRecording(): Promise<TemporaryAudioFile | undefined> {
    this.workflowState = 'translating';

    return Promise.resolve(this.audioFile);
  }

  cancelRecording(): void {
    this.workflowState = 'idle';
    this.audioFile = undefined;
  }

  markTranslating(): void {
    this.workflowState = 'translating';
  }

  markIdle(): void {
    this.workflowState = 'idle';
  }

  getWorkflowState(): TranscriptionWorkflowState {
    return this.workflowState;
  }

  dispose(): void {
    this.cancelRecording();
  }
}

class SmokeTestTranscriptionService implements TranscriptionService {
  private activeTimeout: NodeJS.Timeout | undefined;

  transcribeAudio(
    _audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription> {
    return new Promise<Transcription>((resolve) => {
      this.activeTimeout = setTimeout(() => {
        this.activeTimeout = undefined;
        resolve({
          id: `smoke-${stoppedAt}`,
          startedAt,
          stoppedAt,
          content: 'smoke test confidence transcript',
          confidence: {
            text: 'smoke test confidence transcript',
            averageConfidence: 0.7,
            lowConfidenceRanges: [
              {
                startOffset: 11,
                endOffset: 21,
                confidence: 0.42
              }
            ],
            words: [
              {
                text: 'smoke',
                startOffset: 0,
                endOffset: 5,
                confidence: 0.96,
                confidenceClass: 'high',
                tokens: []
              },
              {
                text: 'test',
                startOffset: 6,
                endOffset: 10,
                confidence: 0.72,
                confidenceClass: 'medium',
                tokens: []
              },
              {
                text: 'confidence',
                startOffset: 11,
                endOffset: 21,
                confidence: 0.42,
                confidenceClass: 'low',
                tokens: []
              },
              {
                text: 'transcript',
                startOffset: 22,
                endOffset: 32,
                confidence: 0.9,
                confidenceClass: 'high',
                tokens: []
              }
            ]
          }
        });
      }, 150);
    });
  }

  cancelTranscription(): void {
    if (this.activeTimeout) {
      clearTimeout(this.activeTimeout);
      this.activeTimeout = undefined;
    }
  }

  dispose(): void {
    this.cancelTranscription();
  }
}
