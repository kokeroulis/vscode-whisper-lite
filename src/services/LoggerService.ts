import * as vscode from 'vscode';

export interface LoggerService {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
  dispose(): void;
}

export class VsCodeLoggerService implements LoggerService {
  constructor(private readonly outputChannel: vscode.OutputChannel) {}

  info(message: string): void {
    this.appendLine('info', message);
  }

  warn(message: string): void {
    this.appendLine('warn', message);
  }

  error(message: string, error?: unknown): void {
    this.appendLine('error', message);

    if (error) {
      this.outputChannel.appendLine(formatError(error));
    }
  }

  dispose(): void {
    this.outputChannel.dispose();
  }

  private appendLine(level: LogLevel, message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] [${level}] ${message}`);
  }
}

export class NoopLoggerService implements LoggerService {
  info(_message: string): void {}

  warn(_message: string): void {}

  error(_message: string, _error?: unknown): void {}

  dispose(): void {}
}

type LogLevel = 'info' | 'warn' | 'error';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}
