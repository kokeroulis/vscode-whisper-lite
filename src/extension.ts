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
  transcribeAudio(
    _audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription> {
    return new Promise<Transcription>(() => {
      void startedAt;
      void stoppedAt;
    });
  }

  cancelTranscription(): void {}

  dispose(): void {
    this.cancelTranscription();
  }
}
