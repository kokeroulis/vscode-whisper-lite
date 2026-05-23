export type Transcription = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  content: string;
};

export type TranscriptionWorkflowState = 'idle' | 'recording' | 'translating';

export interface AudioService {
  startRecording(): void;
  stopRecording(): Promise<Transcription | undefined>;
  cancelTranscription(): void;
  getWorkflowState(): TranscriptionWorkflowState;
  dispose(): void;
}

type RecordingSession = {
  id: string;
  startedAt: number;
};

const mockTranslationDelayMs = 2000;

export class MockAudioService implements AudioService {
  private workflowState: TranscriptionWorkflowState = 'idle';
  private recordingSession: RecordingSession | undefined;
  private translationTimer: NodeJS.Timeout | undefined;
  private translationResolver: ((transcription: Transcription | undefined) => void) | undefined;

  startRecording(): void {
    if (this.workflowState !== 'idle') {
      return;
    }

    this.recordingSession = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt: Date.now()
    };
    this.workflowState = 'recording';
  }

  stopRecording(): Promise<Transcription | undefined> {
    if (this.workflowState !== 'recording' || !this.recordingSession) {
      return Promise.resolve(undefined);
    }

    const stoppedAt = Date.now();
    const recordingSession = this.recordingSession;

    this.workflowState = 'translating';

    return new Promise((resolve) => {
      this.translationResolver = resolve;
      this.translationTimer = setTimeout(() => {
        this.translationTimer = undefined;
        this.translationResolver = undefined;
        this.recordingSession = undefined;
        this.workflowState = 'idle';

        resolve({
          ...recordingSession,
          stoppedAt,
          content: this.createMockContent(recordingSession.startedAt, stoppedAt)
        });
      }, mockTranslationDelayMs);
    });
  }

  cancelTranscription(): void {
    if (this.translationTimer) {
      clearTimeout(this.translationTimer);
      this.translationTimer = undefined;
    }

    this.translationResolver?.(undefined);
    this.translationResolver = undefined;
    this.recordingSession = undefined;
    this.workflowState = 'idle';
  }

  getWorkflowState(): TranscriptionWorkflowState {
    return this.workflowState;
  }

  dispose(): void {
    this.cancelTranscription();
  }

  private createMockContent(startedAt: number, stoppedAt: number): string {
    const elapsedSeconds = Math.max(1, Math.ceil((stoppedAt - startedAt) / 1000));
    const seconds = Array.from({ length: elapsedSeconds }, (_, index) => `second ${index + 1}`);

    return seconds.join(', ');
  }
}
