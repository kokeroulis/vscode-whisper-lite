import { expect, test } from '@playwright/test';
import { Transcription } from '../../src/services/TranscriptionService';
import { TranscriptionWebView } from '../../src/views/TranscriptionWebView';

type VsCodeApi = {
  postMessage: (message: unknown) => void;
};

type VisualWindow = Window & {
  acquireVsCodeApi: () => VsCodeApi;
  vscodeMessages: unknown[];
};

test('transcription webview idle list layout', async ({ page }) => {
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
  const html = new TranscriptionWebView().render({
    cspSource: "'self'",
    nonce: 'visual-test-nonce'
  });

  await page.addInitScript((): void => {
    const visualWindow = window as unknown as VisualWindow;

    visualWindow.vscodeMessages = [];
    visualWindow.acquireVsCodeApi = (): VsCodeApi => ({
      postMessage: (message: unknown): void => {
        visualWindow.vscodeMessages.push(message);
      }
    });
  });
  await page.setContent(html);
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
      }
    `
  });
  await page.evaluate((state: Transcription[]): void => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'state',
          transcriptions: state,
          workflowState: 'idle',
          isUiBlocked: false
        }
      })
    );
  }, transcriptions);

  await expect(page).toHaveScreenshot('transcription-webview-idle-list.png');
});
