import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemporaryAudioFile } from '../../src/services/AudioService';
import {
  DownloadModelService,
  ModelCatalogState,
  ModelDownloadProgress,
  WhisperModelId
} from '../../src/services/DownloadModelService';
import { WhisperCliTranscriptionService } from '../../src/services/TranscriptionService';
import { createMockChildProcess } from '../helpers/mockChildProcess';
import { createExtensionContext } from '../helpers/vscodeContext';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

class FakeDownloadModelService implements DownloadModelService {
  getModelCatalogState(): Promise<ModelCatalogState> {
    return Promise.resolve({
      selectedModelId: 'medium.en',
      models: []
    });
  }

  downloadModel(
    _modelId: WhisperModelId,
    _onProgress: (progress: ModelDownloadProgress) => void
  ): Promise<ModelCatalogState> {
    return this.getModelCatalogState();
  }

  selectModel(_modelId: WhisperModelId): Promise<ModelCatalogState> {
    return this.getModelCatalogState();
  }

  getSelectedModelPath(): Promise<string> {
    return Promise.resolve('/downloaded-models/ggml-medium.en.bin');
  }
}

describe('WhisperCliTranscriptionService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.resetAllMocks();
    await Promise.all(tempRoots.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createFixture(): Promise<{
    audioFile: TemporaryAudioFile;
    service: WhisperCliTranscriptionService;
    tempRoot: string;
  }> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-whisper-lite-transcription-test-'));
    const audioPath = path.join(tempRoot, 'recording.wav');
    tempRoots.push(tempRoot);
    await fs.writeFile(audioPath, 'audio');

    return {
      audioFile: {
        path: audioPath,
        mimeType: 'audio/wav'
      },
      service: new WhisperCliTranscriptionService(
        createExtensionContext('/extension-root'),
        new FakeDownloadModelService()
      ),
      tempRoot
    };
  }

  it('calls whisper-cli with JSON output and returns extracted segment text', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);
    const { audioFile, service } = await createFixture();
    const transcriptionPromise = service.transcribeAudio(audioFile, 100, 200);

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const outputFileIndex = spawnArgs.indexOf('--output-file');
    const outputBasePath = spawnArgs[outputFileIndex + 1];

    await fs.writeFile(
      `${outputBasePath}.json`,
      JSON.stringify({
        result: {
          language: 'en'
        },
        transcription: [
          {
            text: ' hello'
          },
          {
            text: ' world'
          }
        ]
      })
    );
    mockProcess.emitClose(0);

    await expect(transcriptionPromise).resolves.toMatchObject({
      startedAt: 100,
      stoppedAt: 200,
      content: 'hello world',
      whisperJson: {
        result: {
          language: 'en'
        }
      }
    });
    expect(spawn).toHaveBeenCalledWith('/extension-root/vendor/whisper/bin/whisper-cli', [
      '--model',
      '/downloaded-models/ggml-medium.en.bin',
      '--vad',
      '--vad-model',
      '/extension-root/vendor/whisper/models/ggml-silero-v6.2.0.bin',
      '--file',
      audioFile.path,
      '--output-json-full',
      '--output-file',
      outputBasePath,
      '--no-gpu',
      '--no-timestamps'
    ]);
  });

  it('returns a fallback message when no speech segments are detected', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);
    const { audioFile, service } = await createFixture();
    const transcriptionPromise = service.transcribeAudio(audioFile, 100, 200);

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const outputFileIndex = spawnArgs.indexOf('--output-file');
    const outputBasePath = spawnArgs[outputFileIndex + 1];

    await fs.writeFile(`${outputBasePath}.json`, JSON.stringify({ transcription: [] }));
    mockProcess.emitClose(0);

    await expect(transcriptionPromise).resolves.toMatchObject({
      content: 'No speech detected.'
    });
  });

  it('kills the whisper process when transcription is canceled', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);
    const { audioFile, service } = await createFixture();
    const transcriptionPromise = service.transcribeAudio(audioFile, 100, 200);

    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled();
    });

    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] as string[];
    const outputFileIndex = spawnArgs.indexOf('--output-file');
    const outputBasePath = spawnArgs[outputFileIndex + 1];

    service.cancelTranscription();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

    await fs.writeFile(`${outputBasePath}.json`, JSON.stringify({ transcription: [] }));
    mockProcess.emitClose(0);
    await transcriptionPromise;
  });
});
