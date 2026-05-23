import * as path from 'node:path';
import type * as vscode from 'vscode';

export function createExtensionContext(rootPath: string): vscode.ExtensionContext {
  return {
    extensionPath: rootPath,
    globalStorageUri: {
      fsPath: path.join(rootPath, 'global-storage')
    }
  } as unknown as vscode.ExtensionContext;
}
