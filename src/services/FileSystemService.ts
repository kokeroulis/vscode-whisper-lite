import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { TemporaryAudioFile } from './AudioService';
import { LoggerService, NoopLoggerService } from './LoggerService';
import { Transcription } from './TranscriptionService';

export type RecordedAudioPayload = {
  base64Audio: string;
  mimeType: string;
};

export interface FileSystemService {
  loadTranscriptions(): Promise<Transcription[]>;
  saveTranscriptions(transcriptions: Transcription[]): Promise<void>;
  createTemporaryAudioFile(mimeType: string): TemporaryAudioFile;
  saveTemporaryAudioFile(recording: RecordedAudioPayload): Promise<TemporaryAudioFile>;
  deleteTemporaryAudioFile(audioFile: TemporaryAudioFile): Promise<void>;
  clearTemporaryAudioFiles(): Promise<void>;
  getTemporaryAudioDirectory(): string;
}

const storageFileName = 'transcriptions.json';
const temporaryAudioDirectoryName = 'vscode-whisper-lite';

export class VsCodeFileSystemService implements FileSystemService {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: LoggerService = new NoopLoggerService()
  ) {}

  async loadTranscriptions(): Promise<Transcription[]> {
    try {
      const fileContent = await fs.readFile(this.getStorageFilePath(), 'utf8');
      const parsed = JSON.parse(fileContent) as unknown;

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isTranscription);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async saveTranscriptions(transcriptions: Transcription[]): Promise<void> {
    const storageFilePath = this.getStorageFilePath();

    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      storageFilePath,
      `${JSON.stringify(transcriptions, null, 2)}\n`,
      'utf8'
    );

    this.logger.info(
      `Saved ${transcriptions.length} transcription${transcriptions.length === 1 ? '' : 's'} to ${storageFilePath}.`
    );
  }

  createTemporaryAudioFile(mimeType: string): TemporaryAudioFile {
    const extension = getAudioFileExtension(mimeType);
    const fileName = `recording-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;

    const audioFile = {
      path: path.join(this.getTemporaryAudioDirectory(), fileName),
      mimeType
    };

    this.logger.info(`Created temporary audio file path ${audioFile.path}.`);

    return audioFile;
  }

  async saveTemporaryAudioFile(recording: RecordedAudioPayload): Promise<TemporaryAudioFile> {
    const audioFile = this.createTemporaryAudioFile(recording.mimeType);
    const audioBuffer = Buffer.from(recording.base64Audio, 'base64');

    await fs.mkdir(this.getTemporaryAudioDirectory(), { recursive: true });
    await fs.writeFile(audioFile.path, audioBuffer);
    this.logger.info(`Saved temporary audio recording to ${audioFile.path}.`);

    return audioFile;
  }

  async deleteTemporaryAudioFile(audioFile: TemporaryAudioFile): Promise<void> {
    try {
      await fs.unlink(audioFile.path);
      this.logger.info(`Deleted temporary audio file ${audioFile.path}.`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT') {
        this.logger.error(`Could not delete temporary audio file ${audioFile.path}.`, error);
        throw error;
      }
    }
  }

  async clearTemporaryAudioFiles(): Promise<void> {
    const temporaryAudioDirectory = this.getTemporaryAudioDirectory();

    await fs.rm(temporaryAudioDirectory, { recursive: true, force: true });
    this.logger.info(`Cleared temporary audio directory ${temporaryAudioDirectory}.`);
  }

  getTemporaryAudioDirectory(): string {
    return path.join(os.tmpdir(), temporaryAudioDirectoryName);
  }

  private getStorageFilePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, storageFileName);
  }
}

function isTranscription(value: unknown): value is Transcription {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Transcription>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.startedAt === 'number' &&
    (typeof candidate.stoppedAt === 'undefined' || typeof candidate.stoppedAt === 'number') &&
    typeof candidate.content === 'string'
  );
}

function getAudioFileExtension(mimeType: string): string {
  if (mimeType.includes('mp4')) {
    return 'm4a';
  }

  if (mimeType.includes('ogg')) {
    return 'ogg';
  }

  if (mimeType.includes('wav')) {
    return 'wav';
  }

  return 'webm';
}
