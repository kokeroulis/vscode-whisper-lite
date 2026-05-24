import type * as vscode from 'vscode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranscriptionPanelController } from '../../src/controllers/TranscriptionPanelController';
import {
  AudioService,
  TemporaryAudioFile,
  TranscriptionWorkflowState
} from '../../src/services/AudioService';
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
  | { type: 'deleteTranscription'; id: string };

type StateMessage = {
  type: 'state';
  transcriptions: Transcription[];
  workflowState: TranscriptionWorkflowState;
  isUiBlocked: boolean;
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

type ControllerFixture = {
  audioService: FakeAudioService;
  controller: TranscriptionPanelController;
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

    (vscodeMock.window as unknown as MutableVscodeWindow).createWebviewPanel = (): vscode.WebviewPanel =>
      panel as unknown as vscode.WebviewPanel;

    return {
      audioService,
      controller: new TranscriptionPanelController(
        createExtensionContext('/extension-root'),
        audioService,
        transcriptionService,
        fileSystemService,
        new TranscriptionWebView()
      ),
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
    expect(panel.webview.postedMessages).toContainEqual<StateMessage>({
      type: 'state',
      transcriptions: [savedTranscription],
      workflowState: 'idle',
      isUiBlocked: false
    });
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
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function lastStateMessage(panel: FakeWebviewPanel): StateMessage | undefined {
  const stateMessages = panel.webview.postedMessages.filter(isStateMessage);

  return stateMessages.at(-1);
}

function isStateMessage(message: unknown): message is StateMessage {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<StateMessage>;

  return candidate.type === 'state';
}
