import type * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionPanelController } from '../../src/controllers/TranscriptionPanelController';
import {
  AudioService,
  TemporaryAudioFile,
  TranscriptionWorkflowState
} from '../../src/services/AudioService';
import {
  DownloadModelService,
  ModelCatalogState,
  ModelDownloadProgress,
  WhisperModelId
} from '../../src/services/DownloadModelService';
import { FileSystemService } from '../../src/services/FileSystemService';
import { Transcription, TranscriptionService } from '../../src/services/TranscriptionService';
import { TranscriptionWebView } from '../../src/views/TranscriptionWebView';
import { createExtensionContext } from '../helpers/vscodeContext';
import * as vscodeMock from '../mocks/vscode';

type WebviewMessage =
  | { type: 'webviewReady' }
  | { type: 'startTranscription' }
  | { type: 'stopTranscription' }
  | { type: 'cancelTranscription' }
  | { type: 'copyTranscription'; id: string }
  | { type: 'deleteTranscription'; id: string }
  | { type: 'downloadModel'; modelId: WhisperModelId }
  | { type: 'selectModel'; modelId: WhisperModelId };

type StateMessage = {
  type: 'state';
  transcriptions: Transcription[];
  workflowState: TranscriptionWorkflowState;
  isUiBlocked: boolean;
  modelCatalog: ModelCatalogState;
};

type MutableVscodeWindow = {
  createWebviewPanel: () => vscode.WebviewPanel;
};

class FakeWebview {
  options: vscode.WebviewOptions = {};
  html: string = '';
  readonly cspSource: string = 'vscode-webview-test';
  readonly postedMessages: unknown[] = [];
  private messageHandler: ((message: WebviewMessage) => void) | undefined;

  onDidReceiveMessage(listener: (message: WebviewMessage) => void): vscode.Disposable {
    this.messageHandler = listener;

    return {
      dispose: (): void => {
        this.messageHandler = undefined;
      }
    };
  }

  postMessage(message: unknown): Thenable<boolean> {
    this.postedMessages.push(message);

    return Promise.resolve(true);
  }

  emitMessage(message: WebviewMessage): void {
    this.messageHandler?.(message);
  }
}

class FakeWebviewPanel {
  readonly webview: FakeWebview = new FakeWebview();
  readonly reveal: () => void = vi.fn();
  private disposeHandler: (() => void) | undefined;

  onDidDispose(listener: () => void): vscode.Disposable {
    this.disposeHandler = listener;

    return {
      dispose: (): void => {
        this.disposeHandler = undefined;
      }
    };
  }

  dispose(): void {
    this.disposeHandler?.();
  }
}

class FakeAudioService implements AudioService {
  private workflowState: TranscriptionWorkflowState = 'idle';
  private audioFile: TemporaryAudioFile | undefined;
  readonly cancelRecording: () => void = vi.fn((): void => {
    this.audioFile = undefined;
    this.workflowState = 'idle';
  });
  readonly dispose: () => void = vi.fn();

  async startRecording(audioFile: TemporaryAudioFile): Promise<void> {
    this.audioFile = audioFile;
    this.workflowState = 'recording';
  }

  stopRecording(): Promise<TemporaryAudioFile | undefined> {
    this.workflowState = 'translating';

    return Promise.resolve(this.audioFile);
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
}

class FakeTranscriptionService implements TranscriptionService {
  readonly cancelTranscription: () => void = vi.fn();
  readonly dispose: () => void = vi.fn();
  readonly transcribeAudio: TranscriptionService['transcribeAudio'] = vi.fn(
    (
      _audioFile: TemporaryAudioFile,
      startedAt: number,
      stoppedAt: number
    ): Promise<Transcription> =>
      Promise.resolve({
        id: 'generated-transcription',
        startedAt,
        stoppedAt,
        content: 'translated speech from whisper'
      })
  );
}

class FakeFileSystemService implements FileSystemService {
  private temporaryAudioFileIndex: number = 0;
  readonly deletedAudioFiles: TemporaryAudioFile[] = [];
  readonly savedTranscriptions: Transcription[][] = [];

  constructor(private transcriptions: Transcription[] = []) {}

  loadTranscriptions(): Promise<Transcription[]> {
    return Promise.resolve([...this.transcriptions]);
  }

  saveTranscriptions(transcriptions: Transcription[]): Promise<void> {
    this.transcriptions = [...transcriptions];
    this.savedTranscriptions.push([...transcriptions]);

    return Promise.resolve();
  }

  createTemporaryAudioFile(mimeType: string): TemporaryAudioFile {
    this.temporaryAudioFileIndex += 1;

    return {
      path: `/tmp/recording-${this.temporaryAudioFileIndex}.wav`,
      mimeType
    };
  }

  saveTemporaryAudioFile(): Promise<TemporaryAudioFile> {
    return Promise.resolve(this.createTemporaryAudioFile('audio/wav'));
  }

  deleteTemporaryAudioFile(audioFile: TemporaryAudioFile): Promise<void> {
    this.deletedAudioFiles.push(audioFile);

    return Promise.resolve();
  }

  clearTemporaryAudioFiles(): Promise<void> {
    return Promise.resolve();
  }

  getTemporaryAudioDirectory(): string {
    return '/tmp/vscode-whisper-lite-test';
  }
}

class FakeDownloadModelService implements DownloadModelService {
  private modelCatalog: ModelCatalogState = {
    selectedModelId: 'medium.en',
    models: [
      {
        id: 'medium.en',
        name: 'Medium English',
        description: 'English-only Whisper medium model.',
        fileName: 'ggml-medium.en.bin',
        downloadUrl: 'https://example.com/ggml-medium.en.bin',
        sizeLabel: 'Medium',
        installed: false,
        selected: true,
        localPath: '/models/ggml-medium.en.bin',
        status: 'notDownloaded'
      }
    ]
  };
  readonly selectModel: DownloadModelService['selectModel'] = vi.fn(
    (modelId: WhisperModelId): Promise<ModelCatalogState> => {
      this.modelCatalog = {
        selectedModelId: modelId,
        models: this.modelCatalog.models.map((model) => ({
          ...model,
          selected: model.id === modelId
        }))
      };

      return Promise.resolve(this.modelCatalog);
    }
  );
  readonly getSelectedModelPath: DownloadModelService['getSelectedModelPath'] = vi.fn(
    (): Promise<string> => Promise.resolve('/models/ggml-medium.en.bin')
  );

  getModelCatalogState(): Promise<ModelCatalogState> {
    return Promise.resolve(this.modelCatalog);
  }

  downloadModel(
    modelId: WhisperModelId,
    onProgress: (progress: ModelDownloadProgress) => void
  ): Promise<ModelCatalogState> {
    onProgress({
      modelId,
      downloadedBytes: 50,
      totalBytes: 100,
      percent: 50
    });
    this.modelCatalog = {
      selectedModelId: modelId,
      models: this.modelCatalog.models.map((model) => ({
        ...model,
        installed: model.id === modelId ? true : model.installed,
        selected: model.id === modelId,
        status: model.id === modelId ? 'downloaded' : model.status
      }))
    };

    return Promise.resolve(this.modelCatalog);
  }
}

type ControllerFixture = {
  audioService: FakeAudioService;
  controller: TranscriptionPanelController;
  downloadModelService: FakeDownloadModelService;
  fileSystemService: FakeFileSystemService;
  panel: FakeWebviewPanel;
  transcriptionService: FakeTranscriptionService;
};

describe('TranscriptionPanelController functional flow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createFixture(savedTranscriptions: Transcription[] = []): ControllerFixture {
    const panel = new FakeWebviewPanel();
    const audioService = new FakeAudioService();
    const transcriptionService = new FakeTranscriptionService();
    const fileSystemService = new FakeFileSystemService(savedTranscriptions);
    const downloadModelService = new FakeDownloadModelService();

    (vscodeMock.window as unknown as MutableVscodeWindow).createWebviewPanel = (): vscode.WebviewPanel =>
      panel as unknown as vscode.WebviewPanel;

    return {
      audioService,
      controller: new TranscriptionPanelController(
        createExtensionContext('/extension-root'),
        audioService,
        transcriptionService,
        fileSystemService,
        downloadModelService,
        new TranscriptionWebView()
      ),
      downloadModelService,
      fileSystemService,
      panel,
      transcriptionService
    };
  }

  it('opens a webview panel and sends saved transcriptions when the webview is ready', async () => {
    const savedTranscription: Transcription = {
      id: 'saved-transcription',
      startedAt: 100,
      content: 'previous transcription'
    };
    const { controller, panel } = createFixture([savedTranscription]);

    await controller.open();
    panel.webview.emitMessage({ type: 'webviewReady' });
    await flushPromises();

    expect(panel.webview.html).toContain('Whisper Lite');
    expect(panel.webview.postedMessages).toContainEqual(
      expect.objectContaining({
        type: 'state',
        transcriptions: [savedTranscription],
        workflowState: 'idle',
        isUiBlocked: false
      })
    );
  });

  it('records, transcribes, persists the result, and returns the UI to idle', async () => {
    const { controller, fileSystemService, panel, transcriptionService } = createFixture();

    await controller.open();
    panel.webview.emitMessage({ type: 'startTranscription' });
    await flushPromises();

    expect(lastStateMessage(panel)).toMatchObject({
      workflowState: 'recording',
      isUiBlocked: false
    });

    panel.webview.emitMessage({ type: 'stopTranscription' });
    await vi.waitFor(() => {
      expect(fileSystemService.deletedAudioFiles).toEqual([
        {
          path: '/tmp/recording-1.wav',
          mimeType: 'audio/wav'
        }
      ]);
    });

    expect(transcriptionService.transcribeAudio).toHaveBeenCalledWith(
      {
        path: '/tmp/recording-1.wav',
        mimeType: 'audio/wav'
      },
      expect.any(Number),
      expect.any(Number)
    );
    expect(fileSystemService.savedTranscriptions[0]?.[0]).toMatchObject({
      id: 'generated-transcription',
      content: 'translated speech from whisper'
    });
    expect(lastStateMessage(panel)).toMatchObject({
      workflowState: 'idle',
      isUiBlocked: false,
      transcriptions: [
        expect.objectContaining({
          content: 'translated speech from whisper'
        })
      ]
    });
  });

  it('cancels the active workflow without saving a transcription', async () => {
    const { audioService, controller, fileSystemService, panel, transcriptionService } =
      createFixture();

    await controller.open();
    audioService.markTranslating();
    panel.webview.emitMessage({ type: 'cancelTranscription' });
    await flushPromises();

    expect(audioService.cancelRecording).toHaveBeenCalled();
    expect(transcriptionService.cancelTranscription).toHaveBeenCalled();
    expect(fileSystemService.savedTranscriptions).toEqual([]);
    expect(lastStateMessage(panel)).toMatchObject({
      workflowState: 'idle',
      isUiBlocked: false,
      transcriptions: []
    });
  });

  it('downloads a model and posts progress updates to the webview', async () => {
    const { controller, panel } = createFixture();

    await controller.open();
    panel.webview.emitMessage({ type: 'downloadModel', modelId: 'medium.en' });
    await flushPromises();

    const progressState = stateMessages(panel).find((message: StateMessage): boolean => {
      const model = message.modelCatalog.models[0];

      return model?.status === 'downloading';
    });
    const finalModel = lastStateMessage(panel)?.modelCatalog.models[0];

    expect(progressState?.modelCatalog.models[0]?.progress?.percent).toBe(50);
    expect(finalModel).toMatchObject({
      id: 'medium.en',
      installed: true,
      selected: true,
      status: 'downloaded'
    });
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function lastStateMessage(panel: FakeWebviewPanel): StateMessage | undefined {
  return stateMessages(panel).at(-1);
}

function stateMessages(panel: FakeWebviewPanel): StateMessage[] {
  return panel.webview.postedMessages.filter(isStateMessage);
}

function isStateMessage(message: unknown): message is StateMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<StateMessage>;

  return candidate.type === 'state';
}
