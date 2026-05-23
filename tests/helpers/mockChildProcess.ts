import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { ChildProcessWithoutNullStreams } from 'node:child_process';
import { vi } from 'vitest';

export type MockChildProcess = ChildProcessWithoutNullStreams & {
  emitClose(code: number | null): void;
  emitExit(code: number | null): void;
  emitError(error: Error): void;
  emitStderr(text: string): void;
  kill: ReturnType<typeof vi.fn>;
  stderr: Readable;
  stdin: Writable & {
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };
};

export function createMockChildProcess(): MockChildProcess {
  const events = new EventEmitter();
  const stderr = new Readable({
    read(): void {}
  });
  const stdin = new Writable({
    write(_chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
      callback();
    }
  }) as Writable & {
    end: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
  };

  stdin.write = vi.fn();
  stdin.end = vi.fn();

  const processLike = {
    stderr,
    stdin,
    kill: vi.fn(),
    once: events.once.bind(events),
    on: events.on.bind(events),
    emitClose(code: number | null): void {
      events.emit('close', code);
    },
    emitExit(code: number | null): void {
      events.emit('exit', code);
    },
    emitError(error: Error): void {
      events.emit('error', error);
    },
    emitStderr(text: string): void {
      stderr.emit('data', Buffer.from(text));
    }
  };

  return processLike as unknown as MockChildProcess;
}
