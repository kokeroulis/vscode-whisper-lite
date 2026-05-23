import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Transcription } from './AudioService';

export interface FileSystemService {
  loadTranscriptions(): Promise<Transcription[]>;
  saveTranscriptions(transcriptions: Transcription[]): Promise<void>;
}

const storageFileName = 'transcriptions.json';

export class VsCodeFileSystemService implements FileSystemService {
  constructor(private readonly context: vscode.ExtensionContext) {}

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
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    await fs.writeFile(
      this.getStorageFilePath(),
      `${JSON.stringify(transcriptions, null, 2)}\n`,
      'utf8'
    );
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
