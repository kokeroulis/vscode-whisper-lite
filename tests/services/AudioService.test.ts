import { spawn } from 'node:child_process';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { NativeAudioService, TemporaryAudioFile } from '../../src/services/AudioService';
import { createMockChildProcess, MockChildProcess } from '../helpers/mockChildProcess';
import { createExtensionContext } from '../helpers/vscodeContext';

vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}));

describe('NativeAudioService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('starts a native recorder process and enters recording state', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const service = new NativeAudioService(createExtensionContext('/extension-root'));
    const audioFile: TemporaryAudioFile = {
      path: '/tmp/recording.wav',
      mimeType: 'audio/wav'
    };
    const startPromise = service.startRecording(audioFile);

    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    expect(spawn).toHaveBeenCalledWith('/usr/bin/swift', [
      '/extension-root/resources/macos-recorder.swift',
      '/tmp/recording.wav'
    ]);
    expect(service.getWorkflowState()).toBe('recording');
  });

  it('stops recording and resolves the recorded audio file', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const service = new NativeAudioService(createExtensionContext('/extension-root'));
    const audioFile: TemporaryAudioFile = {
      path: '/tmp/recording.wav',
      mimeType: 'audio/wav'
    };
    const startPromise = service.startRecording(audioFile);

    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const stopPromise = service.stopRecording();

    expect(mockProcess.stdin.write).toHaveBeenCalledWith('\n');
    expect(mockProcess.stdin.end).toHaveBeenCalled();
    expect(service.getWorkflowState()).toBe('translating');

    mockProcess.emitClose(0);

    await expect(stopPromise).resolves.toEqual(audioFile);
  });

  it('kills the recorder process when recording is canceled', async () => {
    const mockProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(mockProcess);

    const service = new NativeAudioService(createExtensionContext('/extension-root'));
    const startPromise = service.startRecording({
      path: '/tmp/recording.wav',
      mimeType: 'audio/wav'
    });

    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    service.cancelRecording();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(service.getWorkflowState()).toBe('idle');
  });
});
