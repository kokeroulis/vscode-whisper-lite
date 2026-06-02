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
    offsets?: {
      from?: number;
      to?: number;
    };
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
  confidence?: TranscriptConfidence;
  whisperJson?: WhisperJsonOutput;
};

export type ConfidenceClass = 'high' | 'medium' | 'low';

export type TokenConfidence = {
  text: string;
  tokenId: number;
  confidence: number;
  startMs?: number;
  endMs?: number;
  segmentIndex: number;
};

export type WordConfidence = {
  text: string;
  startOffset: number;
  endOffset: number;
  startMs?: number;
  endMs?: number;
  confidence: number;
  confidenceClass: ConfidenceClass;
  tokens: TokenConfidence[];
};

export type TranscriptConfidence = {
  text: string;
  words: WordConfidence[];
  averageConfidence?: number;
  lowConfidenceRanges: Array<{
    startOffset: number;
    endOffset: number;
    confidence: number;
  }>;
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
      const confidence = extractTranscriptConfidence(whisperJson, content);
      this.logger.info(`Finished transcription for audio file ${audioFile.path}.`);

      return {
        id: `${stoppedAt}-${Math.random().toString(16).slice(2)}`,
        startedAt,
        stoppedAt,
        content,
        ...(confidence ? { confidence } : {}),
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
  const text = normalizeWhisperText(segments.map((segment) => segment.text).join(''));

  return text || 'No speech detected.';
}

function extractTranscriptConfidence(
  whisperJson: WhisperJsonOutput,
  fallbackText: string
): TranscriptConfidence | undefined {
  const tokenSpans = getTokenSpans(whisperJson);

  if (tokenSpans.length === 0) {
    return undefined;
  }

  const rawText = tokenSpans.map((span) => span.token.text).join('');
  const trimStartOffset = rawText.length - rawText.trimStart().length;
  const text = normalizeWhisperText(rawText) || fallbackText;

  if (!text || text === 'No speech detected.') {
    return undefined;
  }

  const adjustedTokenSpans = tokenSpans
    .map((span): TokenSpan => ({
      ...span,
      startOffset: span.startOffset - trimStartOffset,
      endOffset: span.endOffset - trimStartOffset
    }))
    .filter((span): boolean => span.endOffset > 0 && span.startOffset < text.length);
  const words = getDisplayWordSpans(text).map((wordSpan): WordConfidence => {
    const overlappingTokens = adjustedTokenSpans
      .filter((tokenSpan): boolean => spansOverlap(wordSpan, tokenSpan))
      .map((tokenSpan): TokenConfidence => tokenSpan.token);
    const confidence = aggregateWordConfidence(overlappingTokens);

    return {
      text: wordSpan.text,
      startOffset: wordSpan.startOffset,
      endOffset: wordSpan.endOffset,
      confidence,
      confidenceClass: classifyConfidence(confidence),
      tokens: overlappingTokens
    };
  });
  const scoredWords = words.filter((word): boolean => Number.isFinite(word.confidence));

  return {
    text,
    words,
    ...(scoredWords.length > 0
      ? {
          averageConfidence:
            scoredWords.reduce((sum, word): number => sum + word.confidence, 0) / scoredWords.length
        }
      : {}),
    lowConfidenceRanges: words
      .filter((word): boolean => word.confidenceClass === 'low')
      .map((word) => ({
        startOffset: word.startOffset,
        endOffset: word.endOffset,
        confidence: word.confidence
      }))
  };
}

type TextSpan = {
  text: string;
  startOffset: number;
  endOffset: number;
};

type TokenSpan = TextSpan & {
  token: TokenConfidence;
};

function getTokenSpans(whisperJson: WhisperJsonOutput): TokenSpan[] {
  const tokenSpans: TokenSpan[] = [];
  let currentOffset = 0;

  for (const [segmentIndex, segment] of (whisperJson.transcription ?? []).entries()) {
    for (const token of segment.tokens ?? []) {
      if (
        typeof token.text !== 'string' ||
        typeof token.id !== 'number' ||
        typeof token.p !== 'number' ||
        !Number.isFinite(token.p)
      ) {
        continue;
      }

      const sanitizedTokenText = removeWhisperSpecialTokens(token.text);

      if (!sanitizedTokenText) {
        continue;
      }

      const startOffset = currentOffset;
      const endOffset = startOffset + sanitizedTokenText.length;
      currentOffset = endOffset;
      tokenSpans.push({
        text: sanitizedTokenText,
        startOffset,
        endOffset,
        token: {
          text: sanitizedTokenText,
          tokenId: token.id,
          confidence: token.p,
          ...(typeof token.offsets?.from === 'number' ? { startMs: token.offsets.from } : {}),
          ...(typeof token.offsets?.to === 'number' ? { endMs: token.offsets.to } : {}),
          segmentIndex
        }
      });
    }
  }

  return tokenSpans;
}

function getDisplayWordSpans(text: string): TextSpan[] {
  return Array.from(text.matchAll(/\S+/g)).map((match): TextSpan => {
    const startOffset = match.index;
    const word = match[0];

    return {
      text: word,
      startOffset,
      endOffset: startOffset + word.length
    };
  });
}

function spansOverlap(left: TextSpan, right: TextSpan): boolean {
  return left.startOffset < right.endOffset && right.startOffset < left.endOffset;
}

function aggregateWordConfidence(tokens: TokenConfidence[]): number {
  if (tokens.length === 0) {
    return 1;
  }

  return Math.min(...tokens.map((token): number => token.confidence));
}

function classifyConfidence(confidence: number): ConfidenceClass {
  if (confidence >= 0.85) {
    return 'high';
  }

  if (confidence >= 0.6) {
    return 'medium';
  }

  return 'low';
}

function normalizeWhisperText(text: string): string {
  return removeWhisperSpecialTokens(text).trim();
}

function removeWhisperSpecialTokens(text: string): string {
  return text.replace(/<\|.*?\|>/g, '');
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
