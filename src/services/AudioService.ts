export type Transcription = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  content: string;
};

export type TranscriptionUpdateHandler = (transcription: Transcription) => void;

export interface AudioService {
  startTranscription(onUpdate: TranscriptionUpdateHandler): Transcription;
  resumeTranscription(transcription: Transcription, onUpdate: TranscriptionUpdateHandler): void;
  stopTranscription(id: string): void;
  stopAllTranscriptions(): string[];
  isTranscriptionInProgress(): boolean;
  dispose(): void;
}

const tickIntervalMs = 1000;

export class MockAudioService implements AudioService {
  private readonly activeTimers = new Map<string, NodeJS.Timeout>();

  startTranscription(onUpdate: TranscriptionUpdateHandler): Transcription {
    const transcription: Transcription = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      startedAt: Date.now(),
      content: ''
    };

    const updatedTranscription = this.withMockContent(transcription);
    this.startTimer(updatedTranscription, onUpdate);

    return updatedTranscription;
  }

  resumeTranscription(transcription: Transcription, onUpdate: TranscriptionUpdateHandler): void {
    if (transcription.stoppedAt || this.activeTimers.has(transcription.id)) {
      return;
    }

    const updatedTranscription = this.withMockContent(transcription);
    onUpdate(updatedTranscription);
    this.startTimer(updatedTranscription, onUpdate);
  }

  stopTranscription(id: string): void {
    const timer = this.activeTimers.get(id);

    if (!timer) {
      return;
    }

    clearInterval(timer);
    this.activeTimers.delete(id);
  }

  stopAllTranscriptions(): string[] {
    const stoppedIds = Array.from(this.activeTimers.keys());

    for (const id of stoppedIds) {
      this.stopTranscription(id);
    }

    return stoppedIds;
  }

  isTranscriptionInProgress(): boolean {
    return this.activeTimers.size > 0;
  }

  dispose(): void {
    this.stopAllTranscriptions();
  }

  private startTimer(
    transcription: Transcription,
    onUpdate: TranscriptionUpdateHandler
  ): void {
    const timer = setInterval(() => {
      onUpdate(this.withMockContent(transcription));
    }, tickIntervalMs);

    this.activeTimers.set(transcription.id, timer);
  }

  private withMockContent(transcription: Transcription): Transcription {
    return {
      ...transcription,
      content: this.createMockContent(transcription.startedAt)
    };
  }

  private createMockContent(startedAt: number): string {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000) + 1);
    const seconds = Array.from({ length: elapsedSeconds }, (_, index) => `second ${index + 1}`);

    return seconds.join(', ');
  }
}
