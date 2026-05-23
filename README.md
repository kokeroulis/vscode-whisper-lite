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
5. Click `Stop transcription` to stop the current mock transcription.

For now, each mock transcription writes `second 1`, `second 2`, `second 3`, and so on once per second. While a mock transcription is running, the panel shows `Transcription in progress` below the title. Each transcription row has icon buttons for copying its text to the clipboard and deleting it.

## Saved Transcriptions

Transcriptions are saved as JSON in VS Code's extension global storage directory. This keeps generated extension data outside the source repository while still persisting it between local VS Code sessions.

The file is named:

```text
transcriptions.json
```

It is created under the extension-specific `globalStorageUri` managed by VS Code.

## Development Workflow

During development, you can keep TypeScript compiling in watch mode:

```sh
npm run watch
```

After changing extension code, reload the Extension Development Host window with `Cmd+R` to pick up the latest compiled output.

## Project Structure

```text
.
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── src/
│   └── extension.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Next Steps

- Add configuration for locating a local Whisper.cpp binary.
- Add a command for selecting or recording an audio file.
- Pipe audio into Whisper.cpp.
- Insert the transcription result into the active editor.
