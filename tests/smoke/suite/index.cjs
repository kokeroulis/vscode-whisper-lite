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

module.exports = {
  run
};
