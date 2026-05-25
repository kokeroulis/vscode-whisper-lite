import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import { ClientRequest, IncomingMessage } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GithubReleaseDownloadModelService,
  ModelDownloadProgress
} from '../../src/services/DownloadModelService';
import { createExtensionContext } from '../helpers/vscodeContext';

const mockHttpGet = vi.hoisted(() =>
  vi.fn<(url: URL, listener: (response: IncomingMessage) => void) => ClientRequest>()
);

vi.mock('node:http', async (importOriginal: () => Promise<typeof import('node:http')>) => {
  const actual = await importOriginal();

  return {
    ...actual,
    get: mockHttpGet
  };
});

describe('GithubReleaseDownloadModelService', () => {
  const tempRoots: string[] = [];
  const mediumEnglishModelUrlOverrideEnv = 'VSCODE_WHISPER_LITE_MEDIUM_EN_MODEL_URL';
  const originalMediumEnglishModelUrl = process.env[mediumEnglishModelUrlOverrideEnv];

  afterEach(async () => {
    await Promise.all(tempRoots.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })));
    tempRoots.length = 0;
    mockHttpGet.mockReset();
    vi.restoreAllMocks();

    if (typeof originalMediumEnglishModelUrl === 'string') {
      process.env[mediumEnglishModelUrlOverrideEnv] = originalMediumEnglishModelUrl;
    } else {
      delete process.env[mediumEnglishModelUrlOverrideEnv];
    }
  });

  async function createService(): Promise<{
    service: GithubReleaseDownloadModelService;
    tempRoot: string;
  }> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-whisper-lite-model-test-'));
    tempRoots.push(tempRoot);

    return {
      service: new GithubReleaseDownloadModelService(createExtensionContext(tempRoot)),
      tempRoot
    };
  }

  it('reports the medium English model as not downloaded by default', async () => {
    const { service, tempRoot } = await createService();

    await expect(service.getModelCatalogState()).resolves.toMatchObject({
      selectedModelId: 'medium.en',
      models: [
        expect.objectContaining({
          id: 'medium.en',
          installed: false,
          selected: true,
          status: 'notDownloaded',
          localPath: path.join(tempRoot, 'global-storage', 'models', 'ggml-medium.en.bin')
        })
      ]
    });
  });

  it('selects an installed model and persists that selection', async () => {
    const { service, tempRoot } = await createService();
    const modelPath = path.join(tempRoot, 'global-storage', 'models', 'ggml-medium.en.bin');

    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(modelPath, 'model');

    await expect(service.selectModel('medium.en')).resolves.toMatchObject({
      selectedModelId: 'medium.en',
      models: [
        expect.objectContaining({
          installed: true,
          selected: true,
          status: 'downloaded'
        })
      ]
    });
    await expect(service.getSelectedModelPath()).resolves.toBe(modelPath);
  });

  it('rejects selected model path lookup when the model is missing', async () => {
    const { service } = await createService();

    await expect(service.getSelectedModelPath()).rejects.toThrow('Download it before transcribing');
  });

  it('throttles progress updates while downloading a model', async () => {
    const modelContent = Buffer.alloc(200, 'a');
    const progressUpdates: ModelDownloadProgress[] = [];
    const { service, tempRoot } = await createService();

    mockHttpModelDownload(modelContent);
    process.env[mediumEnglishModelUrlOverrideEnv] = 'http://127.0.0.1/ggml-medium.en.bin';

    await service.downloadModel('medium.en', (progress: ModelDownloadProgress): void => {
      progressUpdates.push(progress);
    });

    await expect(
      fs.readFile(path.join(tempRoot, 'global-storage', 'models', 'ggml-medium.en.bin'))
    ).resolves.toEqual(modelContent);
    expect(progressUpdates.length).toBeLessThanOrEqual(100);
    expect(progressUpdates.at(-1)).toMatchObject({
      percent: 100,
      downloadedBytes: modelContent.length,
      totalBytes: modelContent.length
    });
    expect(new Set(progressUpdates.map((progress) => progress.percent)).size).toBe(
      progressUpdates.length
    );
  });
});

function mockHttpModelDownload(content: Buffer): void {
  mockHttpGet.mockImplementation(
    (_url: URL, listener: (response: IncomingMessage) => void): ClientRequest => {
      const request = new EventEmitter() as http.ClientRequest;
      request.end = (): http.ClientRequest => {
        const response = new PassThrough();
        const incomingResponse = response as IncomingMessage;

        incomingResponse.statusCode = 200;
        incomingResponse.headers = {
          'content-length': content.length.toString()
        };
        listener(incomingResponse);
        writeChunk(response, content, 0);

        return request;
      };

      return request;
    }
  );
}

function writeChunk(response: PassThrough, content: Buffer, index: number): void {
  if (index >= content.length) {
    response.end();
    return;
  }

  response.write(content.subarray(index, index + 1), () => {
    setImmediate(() => writeChunk(response, content, index + 1));
  });
}
