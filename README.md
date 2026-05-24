# VS Code Whisper Lite

VS Code Whisper Lite is the starting point for a VS Code extension that will eventually use Whisper.cpp to transcribe speech recordings into text.

This first version intentionally does not include Whisper.cpp integration yet. It provides a working VS Code extension UI with mock transcriptions.

## Requirements

- Node.js 20 or newer
- npm
- VS Code

## Install Dependencies

From the project root:

```sh
npm install
```

## Compile the Extension

```sh
npm run compile
```

This compiles the TypeScript source from `src/` into `out/`, which VS Code uses when running the extension.

## Run Locally in VS Code

1. Open this folder in VS Code.
2. Run `npm install` if you have not already installed dependencies.
3. Open the Run and Debug panel.
4. Choose `Run Extension`.
5. Press `F5`.

VS Code will open a new Extension Development Host window with this extension loaded.

## Use the Extension

In the Extension Development Host window:

1. Open the Command Palette with `Cmd+Shift+P`.
2. Search for `Whisper Lite: Open Transcriptions`.
3. Run the command.
4. Click `Start transcription` in the Whisper Lite panel.
5. Click `Stop transcription` to stop recording and start the Whisper.cpp transcription step.
6. Click `Cancel transcription` during translation if you want to discard the current recording.

Each completed transcription displays the text returned by `whisper-cli`. While recording, the panel shows `Transcription in progress` below the title. After stopping, the panel shows `Translating audio into text`; during that step the only available action is `Cancel transcription`. Canceling discards the current recording and does not add it to the transcription list.

Microphone recording is handled by a small macOS Swift helper launched by the extension host. The webview only sends UI actions to the extension. This avoids VS Code webview microphone sandbox limitations. When you first start recording, macOS may ask for microphone permission for VS Code or for the Swift helper process.

## Saved Transcriptions

Transcriptions are saved as JSON in VS Code's extension global storage directory. This keeps generated extension data outside the source repository while still persisting it between local VS Code sessions.

The file is named:

```text
transcriptions.json
```

It is created under the extension-specific `globalStorageUri` managed by VS Code.

## Temporary Audio Files

Raw microphone audio is saved only as a temporary WAV file while the Whisper.cpp transcription step is running. These files are stored outside the repository in the operating system temp directory:

```text
/var/folders/.../T/vscode-whisper-lite/
```

On macOS, the exact parent directory comes from Node's `os.tmpdir()`, so it can vary by machine and user session. The extension deletes the temporary audio file after translation finishes, and clears this temp folder when the extension starts.

## Set Up Whisper.cpp

To download, build, and package the local Whisper.cpp runtime for this extension:

```sh
scripts/setup-whisper-cpp-macos-arm64.sh
```

By default, this creates:

```text
vendor/whisper/
  bin/
    whisper-cli
  models/
    ggml-silero-v6.2.0.bin
```

The Silero model is small enough to bundle with the extension and is used for voice activity detection, which helps skip silence or background-only audio before transcription.

The English-only medium Whisper model is too large to bundle. The extension downloads it from the GitHub release asset configured in `DownloadModelService` and stores it in VS Code's extension global storage directory:

```text
<globalStorageUri>/models/ggml-medium.en.bin
```

Open the Whisper Lite webview and use the `Models` section to download the model, see download progress, and choose which downloaded model should be used for transcription. For now, only `Medium English` is listed; the service and UI are structured so more models can be added later.

## Development Workflow

During development, you can keep TypeScript compiling in watch mode:

```sh
npm run watch
```

After changing extension code, reload the Extension Development Host window with `Cmd+R` to pick up the latest compiled output.

## Tests

Run the service and controller functional tests with Vitest:

```sh
npm run test
```

Run only service unit tests:

```sh
npm run test:unit
```

Run the real VS Code Extension Development Host smoke test with `@vscode/test-electron`:

```sh
npm run test:smoke
```

Run the Playwright visual regression tests for the extracted webview UI:

```sh
npm run test:visual
```

If Playwright has not installed a local browser yet, run:

```sh
npx playwright install chromium
```

When an intentional UI change updates the screenshot baseline:

```sh
npm run test:visual:update
```

## Project Structure

```text
.
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── src/
│   ├── controllers/
│   │   └── TranscriptionPanelController.ts
│   ├── services/
│   │   ├── AudioService.ts
│   │   ├── FileSystemService.ts
│   │   └── TranscriptionService.ts
│   ├── views/
│   │   └── TranscriptionWebView.ts
│   └── extension.ts
├── tests/
│   ├── functional/
│   ├── services/
│   ├── smoke/
│   └── visual/
├── package.json
├── tsconfig.json
└── README.md
```

## Next Steps

- Add configuration for locating a local Whisper.cpp binary.
- Add a command for selecting or recording an audio file.
- Pipe audio into Whisper.cpp.
- Insert the transcription result into the active editor.
