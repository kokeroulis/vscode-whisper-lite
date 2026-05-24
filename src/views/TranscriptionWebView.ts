import * as vscode from 'vscode';

export type TranscriptionWebViewRenderOptions = {
  cspSource: string;
  nonce: string;
};

export class TranscriptionWebView {
  renderForWebview(webview: vscode.Webview): string {
    return this.render({
      cspSource: webview.cspSource,
      nonce: getNonce()
    });
  }

  render(options: TranscriptionWebViewRenderOptions): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';">
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

    .models {
      display: grid;
      gap: 10px;
      padding: 18px 0;
      border-bottom: 1px solid var(--border);
    }

    .section-title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
    }

    .model-list {
      display: grid;
      gap: 8px;
    }

    .model {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface-soft);
    }

    .model-name {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-weight: 600;
    }

    .model-description {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .model-meta {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
    }

    .model-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }

    .secondary-button {
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: transparent;
      color: var(--text);
      font: inherit;
      cursor: pointer;
      white-space: nowrap;
    }

    .secondary-button:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    .secondary-button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .progress {
      width: min(180px, 100%);
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--border);
    }

    .progress-bar {
      width: 0%;
      height: 100%;
      background: var(--accent);
      transition: width 120ms ease;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 18px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px;
      font-weight: 600;
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

      .model {
        grid-template-columns: 1fr;
      }

      .actions,
      .model-actions {
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
      <button class="primary-button" type="button" id="transcriptionToggle" data-testid="transcription-toggle">Start transcription</button>
    </section>
    <section class="models" aria-label="Whisper models">
      <h2 class="section-title">Models</h2>
      <div class="model-list" id="modelList" data-testid="model-list"></div>
    </section>
    <section class="list" id="transcriptionList" aria-label="Active transcriptions" data-testid="transcription-list"></section>
  </main>

  <script nonce="${options.nonce}">
    const vscode = acquireVsCodeApi();
    const transcriptionToggle = document.getElementById('transcriptionToggle');
    const statusLabel = document.getElementById('statusLabel');
    const transcriptionList = document.getElementById('transcriptionList');
    const modelList = document.getElementById('modelList');
    let transcriptions = [];
    let workflowState = 'idle';
    let isUiBlocked = false;
    let modelCatalog = { models: [], selectedModelId: 'medium.en' };

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
      modelCatalog = event.data.modelCatalog || modelCatalog;
      render();
    });

    modelList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');

      if (!button) {
        return;
      }

      vscode.postMessage({
        type: button.dataset.action,
        modelId: button.dataset.modelId
      });
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
      renderModels();

      if (transcriptions.length === 0) {
        transcriptionList.innerHTML = '<p class="empty-state">No active transcriptions yet.</p>';
        return;
      }

      transcriptionList.replaceChildren(
        ...transcriptions.map((transcription) => createTranscriptionItem(transcription))
      );
    }

    function renderModels() {
      if (modelCatalog.models.length === 0) {
        modelList.innerHTML = '<p class="empty-state">No models configured.</p>';
        return;
      }

      modelList.replaceChildren(...modelCatalog.models.map((model) => createModelItem(model)));
    }

    function createModelItem(model) {
      const item = document.createElement('article');
      item.className = 'model';

      const body = document.createElement('div');
      const name = document.createElement('p');
      const description = document.createElement('p');
      const meta = document.createElement('div');

      name.className = 'model-name';
      name.textContent = model.name;
      if (model.selected) {
        const selectedPill = document.createElement('span');
        selectedPill.className = 'pill';
        selectedPill.textContent = 'Selected';
        name.append(selectedPill);
      }

      description.className = 'model-description';
      description.textContent = model.description;
      meta.className = 'model-meta';
      meta.textContent = getModelMeta(model);
      body.append(name, description, meta);

      const actions = document.createElement('div');
      actions.className = 'model-actions';

      if (model.status === 'downloading') {
        actions.append(createProgress(model));
      } else if (!model.installed) {
        actions.append(createModelButton('downloadModel', model.id, 'Download'));
      } else if (!model.selected) {
        actions.append(createModelButton('selectModel', model.id, 'Use model'));
      }

      item.append(body, actions);
      return item;
    }

    function getModelMeta(model) {
      if (model.status === 'downloading') {
        return model.progress?.percent
          ? \`Downloading \${model.progress.percent}%\`
          : 'Downloading';
      }

      if (model.installed) {
        return \`\${model.sizeLabel} · Downloaded\`;
      }

      return \`\${model.sizeLabel} · Not downloaded\`;
    }

    function createModelButton(action, modelId, label) {
      const button = document.createElement('button');
      button.className = 'secondary-button';
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.modelId = modelId;
      button.disabled = isUiBlocked;
      button.textContent = label;
      return button;
    }

    function createProgress(model) {
      const progress = document.createElement('div');
      const progressBar = document.createElement('div');
      const percent = model.progress?.percent || 0;

      progress.className = 'progress';
      progress.setAttribute('aria-label', \`\${model.name} download progress\`);
      progressBar.className = 'progress-bar';
      progressBar.style.width = \`\${percent}%\`;
      progress.append(progressBar);
      return progress;
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
    vscode.postMessage({ type: 'webviewReady' });
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
