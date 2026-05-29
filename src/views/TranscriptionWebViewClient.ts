((): void => {
  type WorkflowState = 'idle' | 'recording' | 'translating';
  type ModelDownloadStatus = 'notDownloaded' | 'downloaded' | 'downloading' | 'error';
  type ModelAction = 'downloadModel' | 'selectModel';
  type TranscriptionAction = 'copyTranscription' | 'deleteTranscription';
  type ToggleAction = 'startTranscription' | 'stopTranscription' | 'cancelTranscription';

  type OutgoingWebviewMessage =
    | { type: 'webviewReady' }
    | { type: ToggleAction }
    | { type: TranscriptionAction; id: string }
    | { type: ModelAction; modelId: string };

  type VsCodeApi = {
    postMessage(message: OutgoingWebviewMessage): void;
  };

  type VsCodeWindow = Window & {
    acquireVsCodeApi(): VsCodeApi;
  };

  type Transcription = {
    id: string;
    startedAt: number;
    content: string;
  };

  type ModelDownloadProgress = {
    percent?: number;
  };

  type WhisperModelState = {
    id: string;
    name: string;
    description: string;
    sizeLabel: string;
    installed: boolean;
    selected: boolean;
    status: ModelDownloadStatus;
    progress?: ModelDownloadProgress;
  };

  type ModelCatalogState = {
    models: WhisperModelState[];
    selectedModelId: string;
  };

  type WebviewStateMessage = {
    type: 'state';
    transcriptions: Transcription[];
    workflowState: WorkflowState;
    isUiBlocked: boolean;
    modelCatalog: ModelCatalogState;
  };

  class TranscriptionWebViewClient {
    private readonly transcriptionToggle: HTMLButtonElement;
    private readonly statusLabel: HTMLElement;
    private readonly transcriptionList: HTMLElement;
    private readonly modelList: HTMLElement;
    private transcriptions: Transcription[] = [];
    private workflowState: WorkflowState = 'idle';
    private isUiBlocked: boolean = false;
    private modelCatalog: ModelCatalogState = {
      models: [],
      selectedModelId: 'medium.en'
    };

    constructor(private readonly vscode: VsCodeApi) {
      this.transcriptionToggle = getRequiredElement('transcriptionToggle', HTMLButtonElement);
      this.statusLabel = getRequiredElement('statusLabel', HTMLElement);
      this.transcriptionList = getRequiredElement('transcriptionList', HTMLElement);
      this.modelList = getRequiredElement('modelList', HTMLElement);
    }

    start(): void {
      this.transcriptionToggle.addEventListener('click', () => {
        this.vscode.postMessage({
          type: this.getToggleMessageType()
        });
      });

      window.addEventListener('message', (event: MessageEvent<unknown>) => {
        this.handleMessage(event);
      });

      this.modelList.addEventListener('click', (event: MouseEvent) => {
        this.handleModelClick(event);
      });

      this.transcriptionList.addEventListener('click', (event: MouseEvent) => {
        this.handleTranscriptionClick(event);
      });

      this.render();
      this.vscode.postMessage({ type: 'webviewReady' });
    }

    private handleMessage(event: MessageEvent<unknown>): void {
      if (!isWebviewStateMessage(event.data)) {
        return;
      }

      this.transcriptions = event.data.transcriptions;
      this.workflowState = event.data.workflowState;
      this.isUiBlocked = event.data.isUiBlocked;
      this.modelCatalog = event.data.modelCatalog;
      this.render();
    }

    private handleModelClick(event: MouseEvent): void {
      const button = getActionButton(event);

      if (!button || !isModelAction(button.dataset.action) || !button.dataset.modelId) {
        return;
      }

      this.vscode.postMessage({
        type: button.dataset.action,
        modelId: button.dataset.modelId
      });
    }

    private handleTranscriptionClick(event: MouseEvent): void {
      const button = getActionButton(event);

      if (!button || !isTranscriptionAction(button.dataset.action) || !button.dataset.id) {
        return;
      }

      this.vscode.postMessage({
        type: button.dataset.action,
        id: button.dataset.id
      });
    }

    private render(): void {
      this.transcriptionToggle.textContent = this.getToggleLabel();
      this.transcriptionToggle.classList.toggle('running', this.workflowState === 'recording');
      this.transcriptionToggle.classList.toggle('cancel', this.workflowState === 'translating');
      this.transcriptionToggle.disabled = this.isTranscriptionToggleDisabled();
      this.statusLabel.textContent = this.getStatusLabel();
      this.renderModels();

      if (this.transcriptions.length === 0) {
        this.transcriptionList.innerHTML = '<p class="empty-state">No active transcriptions yet.</p>';
        return;
      }

      this.transcriptionList.replaceChildren(
        ...this.transcriptions.map((transcription: Transcription): HTMLElement =>
          this.createTranscriptionItem(transcription)
        )
      );
    }

    private renderModels(): void {
      if (this.modelCatalog.models.length === 0) {
        this.modelList.innerHTML = '<p class="empty-state">No models configured.</p>';
        return;
      }

      this.modelList.replaceChildren(
        ...this.modelCatalog.models.map((model: WhisperModelState): HTMLElement =>
          this.createModelItem(model)
        )
      );
    }

    private createModelItem(model: WhisperModelState): HTMLElement {
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
      meta.textContent = this.getModelMeta(model);
      body.append(name, description, meta);

      const actions = document.createElement('div');
      actions.className = 'model-actions';

      if (model.status === 'downloading') {
        actions.append(this.createProgress(model));
      } else if (!model.installed) {
        actions.append(this.createModelButton('downloadModel', model.id, 'Download'));
      } else if (!model.selected) {
        actions.append(this.createModelButton('selectModel', model.id, 'Use model'));
      }

      item.append(body, actions);
      return item;
    }

    private getModelMeta(model: WhisperModelState): string {
      if (model.status === 'downloading') {
        return model.progress?.percent
          ? `Downloading ${model.progress.percent}%`
          : 'Downloading';
      }

      if (model.installed) {
        return `${model.sizeLabel} · Downloaded`;
      }

      return `${model.sizeLabel} · Not downloaded`;
    }

    private createModelButton(action: ModelAction, modelId: string, label: string): HTMLButtonElement {
      const button = document.createElement('button');
      button.className = 'secondary-button';
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.modelId = modelId;
      button.disabled = this.isUiBlocked;
      button.textContent = label;
      return button;
    }

    private createProgress(model: WhisperModelState): HTMLElement {
      const progress = document.createElement('div');
      const progressBar = document.createElement('div');
      const percent = model.progress?.percent ?? 0;

      progress.className = 'progress';
      progress.setAttribute('aria-label', `${model.name} download progress`);
      progressBar.className = 'progress-bar';
      progressBar.style.width = `${percent}%`;
      progress.append(progressBar);
      return progress;
    }

    private createTranscriptionItem(transcription: Transcription): HTMLElement {
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
        this.createIconButton('copyTranscription', transcription.id, 'Copy transcription', copyIcon()),
        this.createIconButton(
          'deleteTranscription',
          transcription.id,
          'Delete transcription',
          deleteIcon(),
          'delete'
        )
      );

      item.append(body, actions);
      return item;
    }

    private getToggleMessageType(): ToggleAction {
      if (this.workflowState === 'recording') {
        return 'stopTranscription';
      }

      if (this.workflowState === 'translating') {
        return 'cancelTranscription';
      }

      return 'startTranscription';
    }

    private getToggleLabel(): string {
      if (!this.hasUsableSelectedModel() && this.workflowState === 'idle') {
        return 'Model not selected';
      }

      if (this.workflowState === 'recording') {
        return 'Stop transcription';
      }

      if (this.workflowState === 'translating') {
        return 'Cancel transcription';
      }

      return 'Start transcription';
    }

    private isTranscriptionToggleDisabled(): boolean {
      return this.workflowState === 'idle' && !this.hasUsableSelectedModel();
    }

    private getStatusLabel(): string {
      if (this.workflowState === 'recording') {
        return 'Transcription in progress';
      }

      if (this.workflowState === 'translating') {
        return 'Translating audio into text';
      }

      return '';
    }

    private hasUsableSelectedModel(): boolean {
      return this.modelCatalog.models.some(
        (model: WhisperModelState): boolean => model.selected && model.installed
      );
    }

    private createIconButton(
      action: TranscriptionAction,
      id: string,
      label: string,
      icon: string,
      extraClass: string = ''
    ): HTMLButtonElement {
      const button = document.createElement('button');
      button.className = `icon-button ${extraClass}`.trim();
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.id = id;
      button.disabled = this.isUiBlocked;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.innerHTML = icon;
      return button;
    }
  }

  function getRequiredElement<TElement extends HTMLElement>(
    id: string,
    constructor: { new (): TElement }
  ): TElement {
    const element = document.getElementById(id);

    if (!(element instanceof constructor)) {
      throw new Error(`Expected element ${id} to exist.`);
    }

    return element;
  }

  function getActionButton(event: MouseEvent): HTMLButtonElement | null {
    if (!(event.target instanceof Element)) {
      return null;
    }

    return event.target.closest<HTMLButtonElement>('button[data-action]');
  }

  function isModelAction(action: string | undefined): action is ModelAction {
    return action === 'downloadModel' || action === 'selectModel';
  }

  function isTranscriptionAction(action: string | undefined): action is TranscriptionAction {
    return action === 'copyTranscription' || action === 'deleteTranscription';
  }

  function isWebviewStateMessage(value: unknown): value is WebviewStateMessage {
    return (
      isRecord(value) &&
      value.type === 'state' &&
      Array.isArray(value.transcriptions) &&
      isWorkflowState(value.workflowState) &&
      typeof value.isUiBlocked === 'boolean' &&
      isModelCatalogState(value.modelCatalog)
    );
  }

  function isModelCatalogState(value: unknown): value is ModelCatalogState {
    return isRecord(value) && Array.isArray(value.models) && typeof value.selectedModelId === 'string';
  }

  function isWorkflowState(value: unknown): value is WorkflowState {
    return value === 'idle' || value === 'recording' || value === 'translating';
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function copyIcon(): string {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  }

  function deleteIcon(): string {
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>';
  }

  const webviewWindow = window as unknown as VsCodeWindow;
  new TranscriptionWebViewClient(webviewWindow.acquireVsCodeApi()).start();
})();
