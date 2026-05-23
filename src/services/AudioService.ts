import * as path from 'node:path';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as vscode from 'vscode';

export type Transcription = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  content: string;
};

export type TemporaryAudioFile = {
  path: string;
  mimeType: string;
};

export type TranscriptionWorkflowState = 'idle' | 'recording' | 'translating';

export interface AudioService {
  startRecording(audioFile: TemporaryAudioFile): Promise<void>;
  stopRecording(): Promise<TemporaryAudioFile | undefined>;
  translateAudio(
    audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription | undefined>;
  cancelTranscription(): void;
  getWorkflowState(): TranscriptionWorkflowState;
  dispose(): void;
}

const mockTranslationDelayMs = 2000;

export class NativeAudioService implements AudioService {
  private workflowState: TranscriptionWorkflowState = 'idle';
  private recorderProcess: ChildProcessWithoutNullStreams | undefined;
  private recordingAudioFile: TemporaryAudioFile | undefined;
  private translationTimer: NodeJS.Timeout | undefined;
  private translationResolver: ((transcription: Transcription | undefined) => void) | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async startRecording(audioFile: TemporaryAudioFile): Promise<void> {
    if (this.workflowState !== 'idle') {
      return;
    }

    if (process.platform !== 'darwin') {
      throw new Error('Native microphone recording is currently implemented for macOS only.');
    }

    const recorderScriptPath = path.join(
      this.context.extensionPath,
      'resources',
      'macos-recorder.swift'
    );

    this.recorderProcess = spawn('/usr/bin/swift', [recorderScriptPath, audioFile.path]);
    this.recordingAudioFile = audioFile;
    this.workflowState = 'recording';

    this.recorderProcess.once('exit', (code) => {
      if (this.workflowState === 'recording' && code !== 0) {
        this.workflowState = 'idle';
      }
    });

    await waitForRecorderStartup(this.recorderProcess);
  }

  stopRecording(): Promise<TemporaryAudioFile | undefined> {
    if (
      this.workflowState !== 'recording' ||
      !this.recorderProcess ||
      !this.recordingAudioFile
    ) {
      return Promise.resolve(undefined);
    }

    const recorderProcess = this.recorderProcess;
    const audioFile = this.recordingAudioFile;

    this.workflowState = 'translating';
    recorderProcess.stdin.write('\n');
    recorderProcess.stdin.end();

    return new Promise((resolve, reject) => {
      let stderr = '';

      recorderProcess.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      recorderProcess.once('error', reject);
      recorderProcess.once('close', (code) => {
        this.recorderProcess = undefined;
        this.recordingAudioFile = undefined;

        if (code && code !== 0) {
          this.workflowState = 'idle';
          reject(new Error(stderr.trim() || `Recorder exited with code ${code}.`));
          return;
        }

        resolve(audioFile);
      });
    });
  }

  translateAudio(
    audioFile: TemporaryAudioFile,
    startedAt: number,
    stoppedAt: number
  ): Promise<Transcription | undefined> {
    if (this.workflowState !== 'translating') {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      this.translationResolver = resolve;
      this.translationTimer = setTimeout(() => {
        this.translationTimer = undefined;
        this.translationResolver = undefined;
        this.workflowState = 'idle';

        resolve({
          id: `${stoppedAt}-${Math.random().toString(16).slice(2)}`,
          startedAt,
          stoppedAt,
          content: this.createMockContent(startedAt, stoppedAt, audioFile.path)
        });
      }, mockTranslationDelayMs);
    });
  }

  cancelTranscription(): void {
    if (this.recorderProcess) {
      this.recorderProcess.kill('SIGTERM');
      this.recorderProcess = undefined;
    }

    if (this.translationTimer) {
      clearTimeout(this.translationTimer);
      this.translationTimer = undefined;
    }

    this.translationResolver?.(undefined);
    this.translationResolver = undefined;
    this.recordingAudioFile = undefined;
    this.workflowState = 'idle';
  }

  getWorkflowState(): TranscriptionWorkflowState {
    return this.workflowState;
  }

  dispose(): void {
    this.cancelTranscription();
  }

  private createMockContent(startedAt: number, stoppedAt: number, audioPath: string): string {
    const elapsedSeconds = Math.max(1, Math.ceil((stoppedAt - startedAt) / 1000));
    const seconds = Array.from({ length: elapsedSeconds }, (_, index) => `second ${index + 1}`);

    return `${seconds.join(', ')}\n\nMock audio file: ${audioPath}`;
  }
}

function waitForRecorderStartup(recorderProcess: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const startupTimeout = setTimeout(resolve, 500);

    recorderProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    recorderProcess.once('error', (error) => {
      clearTimeout(startupTimeout);
      reject(error);
    });

    recorderProcess.once('exit', (code) => {
      clearTimeout(startupTimeout);

      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `Recorder exited with code ${code}.`));
      }
    });
  });
}
