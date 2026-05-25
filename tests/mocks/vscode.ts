type CommandCallback = (...args: unknown[]) => unknown;

const commandHandlers = new Map<string, CommandCallback>();

export const ViewColumn = {
  One: 1
} as const;

export const window = {
  createWebviewPanel: (): unknown => {
    throw new Error('createWebviewPanel must be provided by the test.');
  },
  registerWebviewPanelSerializer: (): { dispose: () => void } => ({
    dispose: (): void => {}
  }),
  showErrorMessage: async (): Promise<undefined> => undefined,
  showInformationMessage: async (): Promise<undefined> => undefined,
  showWarningMessage: async (): Promise<undefined> => undefined
};

export const commands = {
  registerCommand: (command: string, callback: CommandCallback): { dispose: () => void } => {
    commandHandlers.set(command, callback);

    return {
      dispose: (): void => {
        commandHandlers.delete(command);
      }
    };
  },
  executeCommand: (command: string, ...args: unknown[]): unknown => commandHandlers.get(command)?.(...args)
};

export const env = {
  clipboard: {
    writeText: async (): Promise<void> => {}
  }
};

export const Uri = {
  file: (fsPath: string): { fsPath: string } => ({ fsPath })
};
