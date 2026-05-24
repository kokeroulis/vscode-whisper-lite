import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import { IncomingMessage } from 'node:http';
import { pipeline } from 'node:stream/promises';
import * as vscode from 'vscode';

export type WhisperModelId = 'medium.en';

export type ModelDownloadStatus = 'notDownloaded' | 'downloaded' | 'downloading' | 'error';

export type WhisperModel = {
  id: WhisperModelId;
  name: string;
  description: string;
  fileName: string;
  downloadUrl: string;
  sizeLabel: string;
};

export type ModelDownloadProgress = {
  modelId: WhisperModelId;
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
};

export type WhisperModelState = WhisperModel & {
  installed: boolean;
  selected: boolean;
  localPath: string;
  status: ModelDownloadStatus;
  progress?: ModelDownloadProgress;
};

export type ModelCatalogState = {
  models: WhisperModelState[];
  selectedModelId: WhisperModelId;
};

export type DownloadProgressHandler = (progress: ModelDownloadProgress) => void;

type PersistedModelSettings = {
  selectedModelId?: WhisperModelId;
};

export interface DownloadModelService {
  getModelCatalogState(): Promise<ModelCatalogState>;
  downloadModel(
    modelId: WhisperModelId,
    onProgress: DownloadProgressHandler
  ): Promise<ModelCatalogState>;
  selectModel(modelId: WhisperModelId): Promise<ModelCatalogState>;
  getSelectedModelPath(): Promise<string>;
}

const modelSettingsFileName = 'model-settings.json';

export const whisperModels: WhisperModel[] = [
  {
    id: 'medium.en',
    name: 'Medium English',
    description: 'English-only Whisper medium model.',
    fileName: 'ggml-medium.en.bin',
    downloadUrl:
      'https://github.com/antonistsiapaliokas/vscode-whisper-lite/releases/download/models/ggml-medium.en.bin',
    sizeLabel: 'Medium'
  }
];

export class GithubReleaseDownloadModelService implements DownloadModelService {
  private downloadingModelId: WhisperModelId | undefined;
  private latestProgress: ModelDownloadProgress | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async getModelCatalogState(): Promise<ModelCatalogState> {
    const selectedModelId = await this.getSelectedModelId();
    const models = await Promise.all(
      whisperModels.map(async (model: WhisperModel): Promise<WhisperModelState> => {
        const localPath = this.getModelPath(model);
        const installed = await fileExists(localPath);
        const isDownloading = this.downloadingModelId === model.id;

        return {
          ...model,
          installed,
          selected: selectedModelId === model.id,
          localPath,
          status: getModelStatus(installed, isDownloading),
          progress: isDownloading ? this.latestProgress : undefined
        };
      })
    );

    return {
      models,
      selectedModelId
    };
  }

  async downloadModel(
    modelId: WhisperModelId,
    onProgress: DownloadProgressHandler
  ): Promise<ModelCatalogState> {
    const model = getModel(modelId);
    const localPath = this.getModelPath(model);
    const temporaryPath = `${localPath}.download`;

    this.downloadingModelId = modelId;
    this.latestProgress = {
      modelId,
      downloadedBytes: 0
    };

    try {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await downloadFile(model, temporaryPath, (progress: ModelDownloadProgress): void => {
        this.latestProgress = progress;
        onProgress(progress);
      });
      await fs.rename(temporaryPath, localPath);
      await this.selectModel(modelId);

      return this.getModelCatalogState();
    } finally {
      this.downloadingModelId = undefined;
      this.latestProgress = undefined;
      await deleteIfExists(temporaryPath);
    }
  }

  async selectModel(modelId: WhisperModelId): Promise<ModelCatalogState> {
    const model = getModel(modelId);
    const localPath = this.getModelPath(model);

    if (!(await fileExists(localPath))) {
      throw new Error(`${model.name} is not downloaded yet.`);
    }

    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      this.getSettingsPath(),
      `${JSON.stringify({ selectedModelId: modelId }, null, 2)}\n`,
      'utf8'
    );

    return this.getModelCatalogState();
  }

  async getSelectedModelPath(): Promise<string> {
    const selectedModelId = await this.getSelectedModelId();
    const model = getModel(selectedModelId);
    const localPath = this.getModelPath(model);

    if (!(await fileExists(localPath))) {
      throw new Error(`${model.name} is not downloaded yet. Download it before transcribing.`);
    }

    return localPath;
  }

  private async getSelectedModelId(): Promise<WhisperModelId> {
    try {
      const content = await fs.readFile(this.getSettingsPath(), 'utf8');
      const settings = JSON.parse(content) as PersistedModelSettings;

      if (isWhisperModelId(settings.selectedModelId)) {
        return settings.selectedModelId;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT') {
        throw error;
      }
    }

    return 'medium.en';
  }

  private getModelPath(model: WhisperModel): string {
    return path.join(this.context.globalStorageUri.fsPath, 'models', model.fileName);
  }

  private getSettingsPath(): string {
    return path.join(this.context.globalStorageUri.fsPath, modelSettingsFileName);
  }
}

function getModelStatus(installed: boolean, isDownloading: boolean): ModelDownloadStatus {
  if (isDownloading) {
    return 'downloading';
  }

  return installed ? 'downloaded' : 'notDownloaded';
}

function getModel(modelId: WhisperModelId): WhisperModel {
  const model = whisperModels.find((candidate: WhisperModel): boolean => candidate.id === modelId);

  if (!model) {
    throw new Error(`Unknown Whisper model: ${modelId}`);
  }

  return model;
}

function isWhisperModelId(value: unknown): value is WhisperModelId {
  return whisperModels.some((model: WhisperModel): boolean => model.id === value);
}

function downloadFile(
  model: WhisperModel,
  destinationPath: string,
  onProgress: DownloadProgressHandler
): Promise<void> {
  return new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void) => {
    const request = createRequest(model.downloadUrl, (response: IncomingMessage): void => {
      if (isRedirect(response.statusCode) && response.headers.location) {
        downloadFile(
          {
            ...model,
            downloadUrl: new URL(response.headers.location, model.downloadUrl).toString()
          },
          destinationPath,
          onProgress
        )
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Model download failed with status ${response.statusCode ?? 'unknown'}.`));
        return;
      }

      const totalBytes = parseContentLength(response.headers['content-length']);
      let downloadedBytes = 0;
      const fileStream = fsSync.createWriteStream(destinationPath);

      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        onProgress({
          modelId: model.id,
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : undefined
        });
      });

      pipeline(response, fileStream).then(resolve).catch(reject);
    });

    request.once('error', reject);
    request.end();
  });
}

function createRequest(
  downloadUrl: string,
  listener: (response: IncomingMessage) => void
): http.ClientRequest {
  const url = new URL(downloadUrl);

  return url.protocol === 'https:' ? https.get(url, listener) : http.get(url, listener);
}

function isRedirect(statusCode: number | undefined): boolean {
  return Boolean(statusCode && statusCode >= 300 && statusCode < 400);
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

async function deleteIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}
