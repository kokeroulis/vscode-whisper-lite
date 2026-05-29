import { expect, Page, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Transcription } from '../../src/services/TranscriptionService';
import { ModelCatalogState, WhisperModelState } from '../../src/services/DownloadModelService';
import { TranscriptionWebView } from '../../src/views/TranscriptionWebView';

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

type VisualWindow = Window & {
  acquireVsCodeApi: () => VsCodeApi;
  vscodeMessages: unknown[];
};

type WebviewState = {
  type: 'state';
  transcriptions: Transcription[];
  workflowState: 'idle' | 'recording' | 'translating';
  isUiBlocked: boolean;
  modelCatalog: ModelCatalogState;
};

const baseModel: WhisperModelState = {
  id: 'medium.en',
  name: 'Medium English',
  description: 'English-only Whisper medium model.',
  fileName: 'ggml-medium.en.bin',
  downloadUrl: 'https://example.com/ggml-medium.en.bin',
  sizeLabel: 'Medium',
  installed: true,
  selected: true,
  localPath: '/models/ggml-medium.en.bin',
  status: 'downloaded'
};

const transcriptions: Transcription[] = [
  {
    id: 'visual-1',
    startedAt: Date.UTC(2026, 4, 24, 10, 15, 0),
    stoppedAt: Date.UTC(2026, 4, 24, 10, 15, 8),
    content: 'This is the first captured transcription from Whisper Lite.'
  },
  {
    id: 'visual-2',
    startedAt: Date.UTC(2026, 4, 24, 10, 17, 0),
    stoppedAt: Date.UTC(2026, 4, 24, 10, 17, 4),
    content: 'A second transcription keeps the list layout honest.'
  }
];

test('initial webview shows models and transcriptions', async ({ page }) => {
  await renderWebviewState(page, createState({ workflowState: 'idle' }));

  await expect(page.getByRole('button', { name: 'Start transcription' })).toBeVisible();
  await expect(page.getByText('Medium English')).toBeVisible();
  await expect(page.getByText('Downloaded')).toBeVisible();
  await expect(page.getByText('This is the first captured transcription')).toBeVisible();
  await expect(page.getByText('A second transcription keeps')).toBeVisible();
  await expect(page).toHaveScreenshot('transcription-webview-initial.png');
});

test('idle state disables transcription when no model is downloaded', async ({ page }) => {
  await renderWebviewState(
    page,
    createState({
      workflowState: 'idle',
      model: {
        ...baseModel,
        installed: false,
        selected: true,
        status: 'notDownloaded'
      }
    })
  );

  await expect(page.getByRole('button', { name: 'Model not selected' })).toBeDisabled();
  await expect(page.getByText('Medium English')).toBeVisible();
  await expect(page.getByText('Not downloaded')).toBeVisible();
  await expect(page).toHaveScreenshot('transcription-webview-model-not-selected.png');
});

test('recording state shows stop button while models remain visible', async ({ page }) => {
  await renderWebviewState(page, createState({ workflowState: 'recording' }));

  await expect(page.getByRole('button', { name: 'Stop transcription' })).toBeVisible();
  await expect(page.getByText('Transcription in progress')).toBeVisible();
  await expect(page.getByText('Medium English')).toBeVisible();
  await expect(page).toHaveScreenshot('transcription-webview-recording.png');
});

test('translating state shows cancel button while models remain visible', async ({ page }) => {
  await renderWebviewState(
    page,
    createState({
      workflowState: 'translating',
      isUiBlocked: true
    })
  );

  await expect(page.getByRole('button', { name: 'Cancel transcription' })).toBeVisible();
  await expect(page.getByText('Translating audio into text')).toBeVisible();
  await expect(page.getByText('Medium English')).toBeVisible();
  await expect(page).toHaveScreenshot('transcription-webview-translating.png');
});

test('model download state shows progress bar', async ({ page }) => {
  await renderWebviewState(
    page,
    createState({
      model: {
        ...baseModel,
        installed: false,
        selected: true,
        status: 'downloading',
        progress: {
          modelId: 'medium.en',
          downloadedBytes: 58,
          totalBytes: 100,
          percent: 58
        }
      }
    })
  );

  await expect(page.getByText('Downloading 58%')).toBeVisible();
  await expect(page.getByLabel('Medium English download progress')).toBeVisible();
  await expect(page).toHaveScreenshot('transcription-webview-model-downloading.png');
});

async function renderWebviewState(page: Page, state: WebviewState): Promise<void> {
  const html = new TranscriptionWebView().render({
    cspSource: "'self'",
    nonce: 'visual-test-nonce',
    styleUri: 'transcription-webview.css',
    scriptUri: 'transcription-webview-client.js'
  });
  const stylesheet = fs.readFileSync(
    path.join(process.cwd(), 'out', 'views', 'TranscriptionWebView.css'),
    'utf8'
  );
  const clientScript = fs.readFileSync(
    path.join(process.cwd(), 'out', 'views', 'TranscriptionWebViewClient.js'),
    'utf8'
  );
  const testHtml = html
    .replace(
      '<link rel="stylesheet" href="transcription-webview.css">',
      `<style>${stylesheet}</style>`
    )
    .replace(
      '<script nonce="visual-test-nonce" src="transcription-webview-client.js"></script>',
      `<script nonce="visual-test-nonce">
      window.vscodeMessages = [];
      window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
          window.vscodeMessages.push(message);
        }
      });
    </script>
    <script nonce="visual-test-nonce">${clientScript}</script>`
    );

  await page.setContent(testHtml);
  await page.addStyleTag({
    content: `
      :root {
        --vscode-editor-background: #1f2328;
        --vscode-sideBar-background: #2b3137;
        --vscode-panel-border: #4b5563;
        --vscode-editor-foreground: #f3f4f6;
        --vscode-descriptionForeground: #aeb6c2;
        --vscode-button-background: #2f81f7;
        --vscode-button-foreground: #ffffff;
        --vscode-button-hoverBackground: #1f6feb;
        --vscode-errorForeground: #f85149;
        --vscode-focusBorder: #58a6ff;
        --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --vscode-font-size: 13px;
        --vscode-toolbar-hoverBackground: rgba(177, 186, 196, 0.12);
        --vscode-badge-background: #2f81f7;
        --vscode-badge-foreground: #ffffff;
      }
    `
  });
  await page.evaluate((webviewState: WebviewState): void => {
    const visualWindow = window as unknown as VisualWindow;

    visualWindow.dispatchEvent(
      new MessageEvent('message', {
        data: webviewState
      })
    );
  }, state);
}

function createState(options: {
  workflowState?: WebviewState['workflowState'];
  isUiBlocked?: boolean;
  model?: WhisperModelState;
}): WebviewState {
  return {
    type: 'state',
    transcriptions,
    workflowState: options.workflowState ?? 'idle',
    isUiBlocked: options.isUiBlocked ?? false,
    modelCatalog: {
      selectedModelId: 'medium.en',
      models: [options.model ?? baseModel]
    }
  };
}
