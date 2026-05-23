# VS Code Whisper Lite

VS Code Whisper Lite is the starting point for a VS Code extension that will eventually use Whisper.cpp to transcribe speech recordings into text.

This first version intentionally does not include Whisper.cpp integration yet. It only provides a working VS Code extension scaffold with a placeholder command.

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
2. Search for `Whisper Lite: Start Transcription`.
3. Run the command.

For now, the command shows a placeholder message confirming that the extension is active. The real Whisper.cpp transcription workflow will be added later.

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
