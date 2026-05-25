import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { TemporaryAudioFile } from './AudioService';
import { DownloadModelService } from './DownloadModelService';
import { LoggerService, NoopLoggerService } from './LoggerService';

export type WhisperSegment = {
  text: string;
  timestamps?: {
    from?: string;
    to?: string;
  };
  offsets?: {
    from?: number;
    to?: number;
  };
  tokens?: Array<{
    text?: string;
    id?: number;
    p?: number;
  }>;
};

export type WhisperJsonOutput = {
  result?: {
    language?: string;
  };
  transcription?: WhisperSegment[];
};

export type Transcription = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  content: string;
  whisperJson?: WhisperJsonOutput;
};

type WhisperRuntimePaths = {
  cliPath: string;
  modelPath: string;
  vadModelPath: string;
};

export interface TranscriptionService {
  transcribeAudio(
    audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription>;
  cancelTranscription(): void;
  dispose(): void;
}

export class WhisperCliTranscriptionService implements TranscriptionService {
  private whisperProcess: ChildProcessWithoutNullStreams | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly downloadModelService: DownloadModelService,
    private readonly logger: LoggerService = new NoopLoggerService()
  ) {}

  async transcribeAudio(
    audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription> {
    const outputBasePath = path.join(
      path.dirname(audioFile.path),
      `whisper-output-${Date.now()}-${Math.random().toString(16).slice(2)}`
    );
    const jsonPath = `${outputBasePath}.json`;

    try {
      this.logger.info(`Starting transcription for audio file ${audioFile.path}.`);
      this.logger.info(`Whisper JSON output path: ${jsonPath}.`);
      await this.runWhisperCli(audioFile.path, outputBasePath);

      const jsonContent = await fs.readFile(jsonPath, 'utf8');
      const whisperJson = JSON.parse(jsonContent) as WhisperJsonOutput;
      const content = extractTranscriptionText(whisperJson);
      this.logger.info(`Finished transcription for audio file ${audioFile.path}.`);

      return {
        id: `${stoppedAt}-${Math.random().toString(16).slice(2)}`,
        startedAt,
        stoppedAt,
        content,
        whisperJson
      };
    } catch (error) {
      this.logger.error(`Could not transcribe audio file ${audioFile.path}.`, error);
      throw error;
    } finally {
      this.whisperProcess = undefined;
      await deleteIfExists(`${outputBasePath}.json`);
      await deleteIfExists(`${outputBasePath}.txt`);
    }
  }

  cancelTranscription(): void {
    if (this.whisperProcess) {
      this.logger.warn('Canceling active Whisper transcription process.');
      this.whisperProcess.kill('SIGTERM');
      this.whisperProcess = undefined;
    }
  }

  dispose(): void {
    this.cancelTranscription();
  }

  private async runWhisperCli(audioPath: string, outputBasePath: string): Promise<void> {
    const whisperRuntime = await getWhisperRuntimePaths(this.context, this.downloadModelService);
    const args = [
      '--model',
      whisperRuntime.modelPath,
      '--vad',
      '--vad-model',
      whisperRuntime.vadModelPath,
      '--file',
      audioPath,
      '--output-json-full',
      '--output-file',
      outputBasePath,
      '--no-gpu',
      '--no-timestamps'
    ];

    this.logger.info(`Using Whisper CLI at ${whisperRuntime.cliPath}.`);
    this.logger.info(`Using Whisper model at ${whisperRuntime.modelPath}.`);
    this.logger.info(`Using VAD model at ${whisperRuntime.vadModelPath}.`);
    this.whisperProcess = spawn(whisperRuntime.cliPath, args);

    return new Promise<void>((resolve, reject) => {
      let stderr = '';

      this.whisperProcess?.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      this.whisperProcess?.once('error', reject);
      this.whisperProcess?.once('close', (code: number | null) => {
        if (code && code !== 0) {
          reject(new Error(stderr.trim() || `whisper-cli exited with code ${code}.`));
          return;
        }

        resolve();
      });
    });
  }
}

async function getWhisperRuntimePaths(
  context: vscode.ExtensionContext,
  downloadModelService: DownloadModelService
): Promise<WhisperRuntimePaths> {
  const runtimeRoot = path.join(context.extensionPath, 'vendor', 'whisper');

  return {
    cliPath: path.join(runtimeRoot, 'bin', 'whisper-cli'),
    modelPath: await downloadModelService.getSelectedModelPath(),
    vadModelPath: path.join(runtimeRoot, 'models', 'ggml-silero-v6.2.0.bin')
  };
}

function extractTranscriptionText(whisperJson: WhisperJsonOutput): string {
  const segments = whisperJson.transcription ?? [];
  const text = segments.map((segment) => segment.text).join('').trim();

  return text || 'No speech detected.';
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
