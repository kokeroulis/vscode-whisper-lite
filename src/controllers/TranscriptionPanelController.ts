import * as vscode from 'vscode';
import { AudioService, Transcription } from '../services/AudioService';
import { FileSystemService } from '../services/FileSystemService';

type WebviewMessage =
  | { type: 'startTranscription' }
  | { type: 'stopTranscription' }
  | { type: 'cancelTranscription' }
  | { type: 'copyTranscription'; id: string }
  | { type: 'deleteTranscription'; id: string };

export class TranscriptionPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private transcriptions: Transcription[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly audioService: AudioService,
    private readonly fileSystemService: FileSystemService
  ) {}

  async initialize(): Promise<void> {
    this.transcriptions = await this.fileSystemService.loadTranscriptions();
  }

  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postStateToWebview();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'whisperLiteTranscriptions',
      'Whisper Lite',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => {
        void this.handleWebviewMessage(message);
      }),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      })
    );

    this.postStateToWebview();
  }

  dispose(): void {
    this.audioService.dispose();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
  }

  private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'startTranscription':
        await this.startTranscription();
        return;

      case 'stopTranscription':
        await this.stopTranscription();
        return;

      case 'cancelTranscription':
        this.cancelTranscription();
        return;

      case 'copyTranscription':
        await this.copyTranscription(message.id);
        return;

      case 'deleteTranscription':
        await this.deleteTranscription(message.id);
        return;
    }
  }

  private async startTranscription(): Promise<void> {
    this.audioService.startRecording();
    this.postStateToWebview();
  }

  private async stopTranscription(): Promise<void> {
    const transcriptionPromise = this.audioService.stopRecording();

    this.postStateToWebview();

    const transcription = await transcriptionPromise;

    if (!transcription) {
      this.postStateToWebview();
      return;
    }

    this.transcriptions = [transcription, ...this.transcriptions];
    await this.saveAndRender();
  }

  private cancelTranscription(): void {
    this.audioService.cancelTranscription();
    this.postStateToWebview();
  }

  private async copyTranscription(id: string): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    const transcription = this.transcriptions.find((item) => item.id === id);

    if (!transcription) {
      await vscode.window.showWarningMessage('That transcription no longer exists.');
      return;
    }

    await vscode.env.clipboard.writeText(transcription.content);
    await vscode.window.showInformationMessage('Transcription copied to clipboard.');
  }

  private async deleteTranscription(id: string): Promise<void> {
    if (this.isUiBlocked()) {
      return;
    }

    this.transcriptions = this.transcriptions.filter((item) => item.id !== id);
    await this.saveAndRender();
  }

  private async saveAndRender(): Promise<void> {
    await this.fileSystemService.saveTranscriptions(this.transcriptions);
    this.postStateToWebview();
  }

  private postStateToWebview(): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage({
      type: 'state',
      transcriptions: this.transcriptions,
      workflowState: this.audioService.getWorkflowState(),
      isUiBlocked: this.isUiBlocked()
    });
  }

  private isUiBlocked(): boolean {
    return this.audioService.getWorkflowState() === 'translating';
  }

  private getWebviewHtml(webview: vscode.Webview): string {
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
      --cancel: var(--vscode-errorForeground);
      --cancel-hover: #b83b3b;
      --cancel-text: #ffffff;
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

    .primary-button.cancel {
      background: var(--cancel);
      color: var(--cancel-text);
    }

    .primary-button.cancel:hover {
      background: var(--cancel-hover);
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

    .icon-button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .icon-button:disabled:hover {
      background: transparent;
      color: var(--text);
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
    let workflowState = 'idle';
    let isUiBlocked = false;

    transcriptionToggle.addEventListener('click', () => {
      vscode.postMessage({
        type: getToggleMessageType()
      });
    });

    window.addEventListener('message', (event) => {
      if (event.data.type !== 'state') {
        return;
      }

      transcriptions = event.data.transcriptions;
      workflowState = event.data.workflowState;
      isUiBlocked = Boolean(event.data.isUiBlocked);
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
      transcriptionToggle.textContent = getToggleLabel();
      transcriptionToggle.classList.toggle('running', workflowState === 'recording');
      transcriptionToggle.classList.toggle('cancel', workflowState === 'translating');
      statusLabel.textContent = getStatusLabel();

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

    function getToggleMessageType() {
      if (workflowState === 'recording') {
        return 'stopTranscription';
      }

      if (workflowState === 'translating') {
        return 'cancelTranscription';
      }

      return 'startTranscription';
    }

    function getToggleLabel() {
      if (workflowState === 'recording') {
        return 'Stop transcription';
      }

      if (workflowState === 'translating') {
        return 'Cancel transcription';
      }

      return 'Start transcription';
    }

    function getStatusLabel() {
      if (workflowState === 'recording') {
        return 'Transcription in progress';
      }

      if (workflowState === 'translating') {
        return 'Translating audio into text';
      }

      return '';
    }

    function createIconButton(action, id, label, icon, extraClass = '') {
      const button = document.createElement('button');
      button.className = \`icon-button \${extraClass}\`.trim();
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.id = id;
      button.disabled = isUiBlocked;
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
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
