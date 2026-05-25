import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import * as https from 'node:https';
import { IncomingMessage } from 'node:http';
import { pipeline } from 'node:stream/promises';
import * as vscode from 'vscode';
import { LoggerService, NoopLoggerService } from './LoggerService';

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
const mediumEnglishModelUrlOverrideEnv = 'VSCODE_WHISPER_LITE_MEDIUM_EN_MODEL_URL';

export const whisperModels: WhisperModel[] = [
  {
    id: 'medium.en',
    name: 'Medium English',
    description: 'English-only Whisper medium model.',
    fileName: 'ggml-medium.en.bin',
    downloadUrl:
      'https://github.com/kokeroulis/vscode-whisper-lite/releases/download/release-assets/ggml-medium.en.bin',
    sizeLabel: 'Medium'
  }
];

export class GithubReleaseDownloadModelService implements DownloadModelService {
  private downloadingModelId: WhisperModelId | undefined;
  private latestProgress: ModelDownloadProgress | undefined;
  private latestLoggedDownloadPercent: number | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: LoggerService = new NoopLoggerService()
  ) {}

  async getModelCatalogState(): Promise<ModelCatalogState> {
    const selectedModelId = await this.getSelectedModelId();
    const models = await Promise.all(
      getAvailableModels().map(async (model: WhisperModel): Promise<WhisperModelState> => {
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
    this.latestLoggedDownloadPercent = undefined;
    this.latestProgress = {
      modelId,
      downloadedBytes: 0
    };

    try {
      this.logger.info(`Starting ${model.name} download from ${model.downloadUrl}.`);
      this.logger.info(`Temporary model download path: ${temporaryPath}.`);
      this.logger.info(`Final model path: ${localPath}.`);

      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await downloadFile(model, temporaryPath, (progress: ModelDownloadProgress): void => {
        this.latestProgress = progress;
        this.logDownloadProgress(model, progress);
        onProgress(progress);
      });
      await fs.rename(temporaryPath, localPath);
      this.logger.info(`Downloaded ${model.name} to ${localPath}.`);
      await this.selectModel(modelId);

      return this.getModelCatalogState();
    } catch (error) {
      this.logger.error(`Could not download ${model.name}.`, error);
      throw error;
    } finally {
      this.downloadingModelId = undefined;
      this.latestProgress = undefined;
      this.latestLoggedDownloadPercent = undefined;
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
    this.logger.info(`Selected ${model.name} model at ${localPath}.`);

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

  private logDownloadProgress(model: WhisperModel, progress: ModelDownloadProgress): void {
    if (typeof progress.percent !== 'number') {
      if (typeof this.latestLoggedDownloadPercent === 'undefined') {
        this.latestLoggedDownloadPercent = 0;
        this.logger.info(
          `Downloading ${model.name}: ${formatBytes(progress.downloadedBytes)} received.`
        );
      }

      return;
    }

    const nextLoggedPercent = Math.floor(progress.percent / 10) * 10;

    if (
      typeof this.latestLoggedDownloadPercent === 'number' &&
      nextLoggedPercent <= this.latestLoggedDownloadPercent &&
      progress.percent !== 100
    ) {
      return;
    }

    this.latestLoggedDownloadPercent = nextLoggedPercent;
    this.logger.info(
      `Downloading ${model.name}: ${progress.percent}% (${formatBytes(progress.downloadedBytes)} of ${formatBytes(progress.totalBytes)}).`
    );
  }
}

function getModelStatus(installed: boolean, isDownloading: boolean): ModelDownloadStatus {
  if (isDownloading) {
    return 'downloading';
  }

  return installed ? 'downloaded' : 'notDownloaded';
}

function getModel(modelId: WhisperModelId): WhisperModel {
  const model = getAvailableModels().find(
    (candidate: WhisperModel): boolean => candidate.id === modelId
  );

  if (!model) {
    throw new Error(`Unknown Whisper model: ${modelId}`);
  }

  return model;
}

function isWhisperModelId(value: unknown): value is WhisperModelId {
  return getAvailableModels().some((model: WhisperModel): boolean => model.id === value);
}

function getAvailableModels(): WhisperModel[] {
  const mediumEnglishDownloadUrl = process.env[mediumEnglishModelUrlOverrideEnv];

  if (!mediumEnglishDownloadUrl) {
    return whisperModels;
  }

  return whisperModels.map((model: WhisperModel): WhisperModel => {
    if (model.id !== 'medium.en') {
      return model;
    }

    return {
      ...model,
      downloadUrl: mediumEnglishDownloadUrl
    };
  });
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

function formatBytes(bytes: number | undefined): string {
  if (typeof bytes !== 'number') {
    return 'unknown size';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
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
