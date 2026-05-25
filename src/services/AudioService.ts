import * as path from 'node:path';
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { LoggerService, NoopLoggerService } from './LoggerService';

export type TemporaryAudioFile = {
  path: string;
  mimeType: string;
};

export type TranscriptionWorkflowState = 'idle' | 'recording' | 'translating';

export interface AudioService {
  startRecording(audioFile: TemporaryAudioFile): Promise<void>;
  stopRecording(): Promise<TemporaryAudioFile | undefined>;
  cancelRecording(): void;
  markTranslating(): void;
  markIdle(): void;
  getWorkflowState(): TranscriptionWorkflowState;
  dispose(): void;
}

export class NativeAudioService implements AudioService {
  private workflowState: TranscriptionWorkflowState = 'idle';
  private recorderProcess: ChildProcessWithoutNullStreams | undefined;
  private recordingAudioFile: TemporaryAudioFile | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: LoggerService = new NoopLoggerService()
  ) {}

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

    this.logger.info(`Starting microphone recording to ${audioFile.path}.`);
    this.logger.info(`Using macOS recorder script at ${recorderScriptPath}.`);
    this.recorderProcess = spawn('/usr/bin/swift', [recorderScriptPath, audioFile.path]);
    this.recordingAudioFile = audioFile;
    this.workflowState = 'recording';

    this.recorderProcess.once('exit', (code: number | null) => {
      if (this.workflowState === 'recording' && code !== 0) {
        this.workflowState = 'idle';
      }
    });

    try {
      await waitForRecorderStartup(this.recorderProcess);
      this.logger.info('Microphone recording started.');
    } catch (error) {
      this.logger.error('Could not start microphone recording.', error);
      throw error;
    }
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
    this.logger.info(`Stopping microphone recording for ${audioFile.path}.`);
    recorderProcess.stdin.write('\n');
    recorderProcess.stdin.end();

    return new Promise<TemporaryAudioFile | undefined>((resolve, reject) => {
      let stderr = '';

      recorderProcess.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      recorderProcess.once('error', reject);
      recorderProcess.once('close', (code: number | null) => {
        this.recorderProcess = undefined;
        this.recordingAudioFile = undefined;

        if (code && code !== 0) {
          this.workflowState = 'idle';
          this.logger.error(`Recorder failed while writing ${audioFile.path}.`, stderr.trim());
          reject(new Error(stderr.trim() || `Recorder exited with code ${code}.`));
          return;
        }

        this.logger.info(`Microphone recording saved to ${audioFile.path}.`);
        resolve(audioFile);
      });
    });
  }

  cancelRecording(): void {
    if (this.recorderProcess) {
      this.logger.warn('Canceling microphone recording.');
      this.recorderProcess.kill('SIGTERM');
      this.recorderProcess = undefined;
    }

    this.recordingAudioFile = undefined;
    this.workflowState = 'idle';
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

  dispose(): void {
    this.cancelRecording();
  }
}

function waitForRecorderStartup(recorderProcess: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise<void>((resolve: () => void, reject: (reason?: unknown) => void) => {
    let stderr = '';
    const startupTimeout = setTimeout(resolve, 500);

    recorderProcess.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    recorderProcess.once('error', (error: Error) => {
      clearTimeout(startupTimeout);
      reject(error);
    });

    recorderProcess.once('exit', (code: number | null) => {
      clearTimeout(startupTimeout);

      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `Recorder exited with code ${code}.`));
      }
    });
  });
}
