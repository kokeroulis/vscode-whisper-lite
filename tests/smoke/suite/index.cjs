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
}

module.exports = {
  run
};
