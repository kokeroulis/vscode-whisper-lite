import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

type Transcription = {
  id: string;
  startedAt: number;
  stoppedAt?: number;
  content: string;
};

type WebviewMessage =
  | { type: 'startTranscription' }
  | { type: 'stopTranscription' }
  | { type: 'copyTranscription'; id: string }
  | { type: 'deleteTranscription'; id: string };

const storageFileName = 'transcriptions.json';
const tickIntervalMs = 1000;

let panel: vscode.WebviewPanel | undefined;
let transcriptions: Transcription[] = [];
const activeTimers = new Map<string, NodeJS.Timeout>();
let extensionContext: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  transcriptions = await loadTranscriptions(context);
  resumeMockTranscriptions(context);

  const openUiCommand = vscode.commands.registerCommand(
    'vscode-whisper-lite.openTranscriptions',
    () => {
      openTranscriptionPanel(context);
    }
  );

  context.subscriptions.push(openUiCommand);
}

export function deactivate() {
  for (const timer of activeTimers.values()) {
    clearInterval(timer);
  }

  activeTimers.clear();
}

async function openTranscriptionPanel(context: vscode.ExtensionContext) {
  if (panel) {
    panel.reveal(vscode.ViewColumn.One);
    postStateToWebview();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'whisperLiteTranscriptions',
    'Whisper Lite',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview);
  panel.webview.onDidReceiveMessage(handleWebviewMessage, undefined, context.subscriptions);
  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions
  );

  postStateToWebview();
}

async function handleWebviewMessage(message: WebviewMessage) {
  switch (message.type) {
    case 'startTranscription':
      await startMockTranscription(extensionContext);
      return;

    case 'stopTranscription':
      await stopMockTranscriptions(extensionContext);
      return;

    case 'copyTranscription':
      await copyTranscription(message.id);
      return;

    case 'deleteTranscription':
      await deleteTranscription(extensionContext, message.id);
      return;
  }
}

async function startMockTranscription(context: vscode.ExtensionContext) {
  const transcription: Transcription = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    startedAt: Date.now(),
    content: ''
  };

  transcriptions = [transcription, ...transcriptions];
  await updateMockContent(context, transcription.id);
  startTimer(context, transcription.id);
  postStateToWebview();
}

function resumeMockTranscriptions(context: vscode.ExtensionContext) {
  for (const transcription of transcriptions) {
    if (transcription.stoppedAt) {
      continue;
    }

    startTimer(context, transcription.id);
  }
}

function startTimer(context: vscode.ExtensionContext, id: string) {
  if (activeTimers.has(id)) {
    return;
  }

  const timer = setInterval(() => {
    void updateMockContent(context, id);
  }, tickIntervalMs);

  activeTimers.set(id, timer);
}

async function updateMockContent(context: vscode.ExtensionContext, id: string) {
  const transcription = transcriptions.find((item) => item.id === id);

  if (!transcription) {
    return;
  }

  transcription.content = createMockContent(transcription.startedAt);
  await saveTranscriptions(context, transcriptions);
  postStateToWebview();
}

async function stopMockTranscriptions(context: vscode.ExtensionContext) {
  for (const [id, timer] of activeTimers.entries()) {
    clearInterval(timer);
    const transcription = transcriptions.find((item) => item.id === id);

    if (transcription) {
      transcription.stoppedAt = Date.now();
    }
  }

  activeTimers.clear();
  await saveTranscriptions(context, transcriptions);
  postStateToWebview();
}

function createMockContent(startedAt: number) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000) + 1);
  const seconds = Array.from({ length: elapsedSeconds }, (_, index) => `second ${index + 1}`);

  return seconds.join(', ');
}

async function copyTranscription(id: string) {
  const transcription = transcriptions.find((item) => item.id === id);

  if (!transcription) {
    await vscode.window.showWarningMessage('That transcription no longer exists.');
    return;
  }

  await vscode.env.clipboard.writeText(transcription.content);
  await vscode.window.showInformationMessage('Transcription copied to clipboard.');
}

async function deleteTranscription(context: vscode.ExtensionContext, id: string) {
  const timer = activeTimers.get(id);

  if (timer) {
    clearInterval(timer);
    activeTimers.delete(id);
  }

  transcriptions = transcriptions.filter((item) => item.id !== id);
  await saveTranscriptions(context, transcriptions);
  postStateToWebview();
}

async function loadTranscriptions(context: vscode.ExtensionContext): Promise<Transcription[]> {
  const filePath = getStorageFilePath(context);

  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(fileContent) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isTranscription);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function saveTranscriptions(context: vscode.ExtensionContext, items: Transcription[]) {
  await fs.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  await fs.writeFile(getStorageFilePath(context), `${JSON.stringify(items, null, 2)}\n`, 'utf8');
}

function getStorageFilePath(context: vscode.ExtensionContext) {
  return path.join(context.globalStorageUri.fsPath, storageFileName);
}

function isTranscription(value: unknown): value is Transcription {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Transcription>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.startedAt === 'number' &&
    (typeof candidate.stoppedAt === 'undefined' || typeof candidate.stoppedAt === 'number') &&
    typeof candidate.content === 'string'
  );
}

function postStateToWebview() {
  if (!panel) {
    return;
  }

  void panel.webview.postMessage({
    type: 'state',
    transcriptions,
    isTranscriptionInProgress: activeTimers.size > 0
  });
}

function getWebviewHtml(webview: vscode.Webview) {
  const nonce = getNonce();
  const cspSource = webview.cspSource;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Whisper Lite</title>
  <style>
    :root {
      color-scheme: light dark;
      --surface: var(--vscode-editor-background);
      --surface-soft: var(--vscode-sideBar-background);
      --border: var(--vscode-panel-border);
      --text: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-text: var(--vscode-button-foreground);
      --accent-hover: var(--vscode-button-hoverBackground);
      --warning: #d9a441;
      --warning-hover: #c58f2f;
      --warning-text: #1f1f1f;
      --danger: var(--vscode-errorForeground);
      --focus: var(--vscode-focusBorder);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-width: 280px;
      background: var(--surface);
      color: var(--text);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .app {
      width: min(920px, 100%);
      margin: 0 auto;
      padding: 24px;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
    }

    .heading {
      min-width: 0;
    }

    .title {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .status {
      min-height: 18px;
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }

    .primary-button {
      min-height: 34px;
      padding: 0 14px;
      border: 0;
      border-radius: 4px;
      background: var(--accent);
      color: var(--accent-text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }

    .primary-button:hover {
      background: var(--accent-hover);
    }

    .primary-button.running {
      background: var(--warning);
      color: var(--warning-text);
    }

    .primary-button.running:hover {
      background: var(--warning-hover);
    }

    button:focus-visible {
      outline: 1px solid var(--focus);
      outline-offset: 2px;
    }

    .list {
      display: grid;
      gap: 10px;
      margin-top: 18px;
    }

    .empty-state {
      padding: 28px 0;
      color: var(--muted);
    }

    .transcription {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-soft);
    }

    .content {
      margin: 0;
      line-height: 1.5;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .meta {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
    }

    .actions {
      display: flex;
      gap: 6px;
    }

    .icon-button {
      display: inline-grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }

    .icon-button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .icon-button.delete:hover {
      color: var(--danger);
    }

    .icon {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 2;
    }

    @media (max-width: 520px) {
      .app {
        padding: 16px;
      }

      .toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      .primary-button {
        width: 100%;
      }

      .transcription {
        grid-template-columns: 1fr;
      }

      .actions {
        justify-content: flex-end;
      }
    }
  </style>
</head>
<body>
  <main class="app">
    <section class="toolbar" aria-label="Transcription controls">
      <div class="heading">
        <h1 class="title">Whisper Lite</h1>
        <div class="status" id="statusLabel" aria-live="polite"></div>
      </div>
      <button class="primary-button" type="button" id="transcriptionToggle">Start transcription</button>
    </section>
    <section class="list" id="transcriptionList" aria-label="Active transcriptions"></section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const transcriptionToggle = document.getElementById('transcriptionToggle');
    const statusLabel = document.getElementById('statusLabel');
    const transcriptionList = document.getElementById('transcriptionList');
    let transcriptions = [];
    let isTranscriptionInProgress = false;

    transcriptionToggle.addEventListener('click', () => {
      vscode.postMessage({
        type: isTranscriptionInProgress ? 'stopTranscription' : 'startTranscription'
      });
    });

    window.addEventListener('message', (event) => {
      if (event.data.type !== 'state') {
        return;
      }

      transcriptions = event.data.transcriptions;
      isTranscriptionInProgress = Boolean(event.data.isTranscriptionInProgress);
      render();
    });

    transcriptionList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');

      if (!button) {
        return;
      }

      vscode.postMessage({
        type: button.dataset.action,
        id: button.dataset.id
      });
    });

    function render() {
      transcriptionToggle.textContent = isTranscriptionInProgress
        ? 'Stop transcription'
        : 'Start transcription';
      transcriptionToggle.classList.toggle('running', isTranscriptionInProgress);
      statusLabel.textContent = isTranscriptionInProgress
        ? 'Transcription in progress'
        : '';

      if (transcriptions.length === 0) {
        transcriptionList.innerHTML = '<p class="empty-state">No active transcriptions yet.</p>';
        return;
      }

      transcriptionList.replaceChildren(
        ...transcriptions.map((transcription) => createTranscriptionItem(transcription))
      );
    }

    function createTranscriptionItem(transcription) {
      const item = document.createElement('article');
      item.className = 'transcription';

      const body = document.createElement('div');
      const content = document.createElement('p');
      const meta = document.createElement('div');

      content.className = 'content';
      content.textContent = transcription.content || 'second 1';
      meta.className = 'meta';
      meta.textContent = new Date(transcription.startedAt).toLocaleString();
      body.append(content, meta);

      const actions = document.createElement('div');
      actions.className = 'actions';
      actions.append(
        createIconButton('copyTranscription', transcription.id, 'Copy transcription', copyIcon()),
        createIconButton('deleteTranscription', transcription.id, 'Delete transcription', deleteIcon(), 'delete')
      );

      item.append(body, actions);
      return item;
    }

    function createIconButton(action, id, label, icon, extraClass = '') {
      const button = document.createElement('button');
      button.className = \`icon-button \${extraClass}\`.trim();
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.id = id;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = icon;
      return button;
    }

    function copyIcon() {
      return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    }

    function deleteIcon() {
      return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
    }

    render();
  </script>
</body>
</html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
