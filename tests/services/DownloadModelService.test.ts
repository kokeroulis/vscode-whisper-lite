import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GithubReleaseDownloadModelService } from '../../src/services/DownloadModelService';
import { createExtensionContext } from '../helpers/vscodeContext';

describe('GithubReleaseDownloadModelService', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((tempRoot) => fs.rm(tempRoot, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  async function createService(): Promise<{
    service: GithubReleaseDownloadModelService;
    tempRoot: string;
  }> {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-whisper-lite-model-test-'));
    tempRoots.push(tempRoot);

    return {
      service: new GithubReleaseDownloadModelService(createExtensionContext(tempRoot)),
      tempRoot
    };
  }

  it('reports the medium English model as not downloaded by default', async () => {
    const { service, tempRoot } = await createService();

    await expect(service.getModelCatalogState()).resolves.toMatchObject({
      selectedModelId: 'medium.en',
      models: [
        expect.objectContaining({
          id: 'medium.en',
          installed: false,
          selected: true,
          status: 'notDownloaded',
          localPath: path.join(tempRoot, 'global-storage', 'models', 'ggml-medium.en.bin')
        })
      ]
    });
  });

  it('selects an installed model and persists that selection', async () => {
    const { service, tempRoot } = await createService();
    const modelPath = path.join(tempRoot, 'global-storage', 'models', 'ggml-medium.en.bin');

    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await fs.writeFile(modelPath, 'model');

    await expect(service.selectModel('medium.en')).resolves.toMatchObject({
      selectedModelId: 'medium.en',
      models: [
        expect.objectContaining({
          installed: true,
          selected: true,
          status: 'downloaded'
        })
      ]
    });
    await expect(service.getSelectedModelPath()).resolves.toBe(modelPath);
  });

  it('rejects selected model path lookup when the model is missing', async () => {
    const { service } = await createService();

    await expect(service.getSelectedModelPath()).rejects.toThrow('Download it before transcribing');
  });
});
