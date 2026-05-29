import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VsCodeFileSystemService } from '../../src/services/FileSystemService';
import { Transcription } from '../../src/services/TranscriptionService';
import { createExtensionContext } from '../helpers/vscodeContext';

describe('VsCodeFileSystemService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  type ServiceFixture = {
    service: VsCodeFileSystemService;
    tempRoot: string;
  };

  async function createService(): Promise<ServiceFixture> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-whisper-lite-test-'));
    tempRoots.push(tempRoot);

    return {
      service: new VsCodeFileSystemService(createExtensionContext(tempRoot)),
      tempRoot
    };
  }

  it('returns an empty transcription list when storage does not exist', async () => {
    const { service } = await createService();

    await expect(service.loadTranscriptions()).resolves.toEqual([]);
  });

  it('saves and loads valid transcriptions', async () => {
    const { service } = await createService();
    const transcriptions: Transcription[] = [
      {
        id: 'transcription-1',
        startedAt: 100,
        stoppedAt: 200,
        content: 'hello world'
      }
    ];

    await service.saveTranscriptions(transcriptions);

    await expect(service.loadTranscriptions()).resolves.toEqual(transcriptions);
  });

  it('loads legacy transcriptions without confidence metadata', async () => {
    const { service, tempRoot } = await createService();
    const storagePath = path.join(tempRoot, 'global-storage', 'transcriptions.json');

    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(
      storagePath,
      JSON.stringify([
        {
          id: 'legacy-transcription',
          startedAt: 100,
          stoppedAt: 200,
          content: 'saved before confidence metadata existed'
        }
      ])
    );

    await expect(service.loadTranscriptions()).resolves.toEqual([
      {
        id: 'legacy-transcription',
        startedAt: 100,
        stoppedAt: 200,
        content: 'saved before confidence metadata existed'
      }
    ]);
  });

  it('filters invalid transcription records while loading', async () => {
    const { service, tempRoot } = await createService();
    const storagePath = path.join(tempRoot, 'global-storage', 'transcriptions.json');

    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(
      storagePath,
      JSON.stringify([
        {
          id: 'valid',
          startedAt: 100,
          content: 'valid text'
        },
        {
          id: 'invalid'
        }
      ])
    );

    await expect(service.loadTranscriptions()).resolves.toEqual([
      {
        id: 'valid',
        startedAt: 100,
        content: 'valid text'
      }
    ]);
  });

  it('saves base64 audio into a temporary file', async () => {
    const { service } = await createService();
    const audioFile = await service.saveTemporaryAudioFile({
      base64Audio: Buffer.from('audio bytes').toString('base64'),
      mimeType: 'audio/wav'
    });

    await expect(fs.readFile(audioFile.path, 'utf8')).resolves.toBe('audio bytes');
    expect(audioFile.path.endsWith('.wav')).toBe(true);
    expect(audioFile.mimeType).toBe('audio/wav');
  });
});
