const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.getExtension('antonistsiapaliokas.vscode-whisper-lite');

  assert.ok(extension, 'Whisper Lite extension should be discoverable by VS Code');
  await extension.activate();

  const commands = await vscode.commands.getCommands(false);

  assert.ok(
    commands.includes('vscode-whisper-lite.openTranscriptions'),
    'Whisper Lite command should be registered'
  );

  await vscode.commands.executeCommand('vscode-whisper-lite.openTranscriptions');

  const whisperTab = await waitForWhisperLiteTab();

  assert.equal(whisperTab.label, 'Whisper Lite');
  assert.ok(
    whisperTab.input instanceof vscode.TabInputWebview,
    'Whisper Lite command should open a webview tab'
  );
  assert.ok(
    whisperTab.input.viewType.endsWith('whisperLiteTranscriptions'),
    `Unexpected webview type: ${whisperTab.input.viewType}`
  );

  await vscode.commands.executeCommand('vscode-whisper-lite.test.startTranscription');
  await waitForState((state) => state.workflowState === 'recording', 'recording state');

  await vscode.commands.executeCommand('vscode-whisper-lite.test.stopTranscription');
  await waitForState((state) => state.workflowState === 'translating', 'translating state');

  await vscode.commands.executeCommand('vscode-whisper-lite.test.cancelTranscription');
  await waitForState((state) => state.workflowState === 'idle', 'idle state after cancel');

  await vscode.commands.executeCommand('vscode-whisper-lite.test.downloadModel');
  const downloadedState = await waitForState(
    (state) =>
      state.modelCatalog.models.some(
        (model) => model.id === 'medium.en' && model.installed && model.selected
      ),
    'downloaded medium model'
  );

  const mediumModel = downloadedState.modelCatalog.models.find((model) => model.id === 'medium.en');

  assert.ok(mediumModel, 'Medium English model should exist in the catalog.');
  assert.equal(mediumModel.status, 'downloaded');
}

async function waitForWhisperLiteTab() {
  const timeoutAt = Date.now() + 5000;

  while (Date.now() < timeoutAt) {
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;

    if (
      activeTab &&
      activeTab.label === 'Whisper Lite' &&
      activeTab.input instanceof vscode.TabInputWebview
    ) {
      return activeTab;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error('Whisper Lite webview tab did not open.');
}

async function waitForState(predicate, description) {
  const timeoutAt = Date.now() + 5000;

  while (Date.now() < timeoutAt) {
    const state = await vscode.commands.executeCommand('vscode-whisper-lite.test.getState');

    if (state && predicate(state)) {
      return state;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

module.exports = {
  run
};
