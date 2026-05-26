# VS Code Whisper Lite

## Introduction

VS Code Whisper Lite is a VS Code extension for recording speech and turning it into text from inside the editor.
Transcription is powered by [Whisper.cpp](https://github.com/ggml-org/whisper.cpp), a port of [openai/whisper](https://github.com/openai/whisper), runs offline, and keeps audio and transcription data local without external transcription API calls.

## Usage

1. Open the Command Palette with `Cmd+Shift+P`, then run `Whisper Lite: Open Transcriptions`.
2. Download and select a model from the `Models` section.
3. Click `Start transcription` and allow microphone access if macOS asks.
4. Click `Stop transcription` to finish recording and start local transcription.
5. Copy or delete completed transcriptions from the list.

## Development

At the moment, VS Code Whisper Lite supports macOS only. Use a recent Node.js version. If you need to manage Node versions locally, install Node through [nvm](https://github.com/nvm-sh/nvm).

From the project root:

```sh
npm install
npm run compile
```

To run the extension locally, open this folder in VS Code, open the Run and Debug panel, choose `Run Extension`, and press `F5`.

Useful development commands:

```sh
npm run lint
npm run test
npm run test:unit
npm run test:smoke
npm run test:visual
```

To build the bundled Whisper.cpp runtime assets for macOS Apple Silicon:

```sh
scripts/setup-whisper-cpp-macos-arm64.sh
```

This creates `vendor/whisper/bin/whisper-cli` and bundles the small Silero voice activity detection model.

## Models

The extension currently hosts only the `Medium English` Whisper model as an asset on this repository's GitHub Releases page.
That model is downloaded on demand and stored in VS Code extension global storage instead of being bundled with the extension.

More Whisper.cpp-compatible models are available from the upstream Hugging Face model page:

[https://huggingface.co/ggerganov/whisper.cpp/tree/main](https://huggingface.co/ggerganov/whisper.cpp/tree/main)

For most people, the bundled `Medium English` download option may be good enough. `large-v3-turbo` is an extra option available upstream: it is similar to `large-v3` in quality, with a small accuracy tradeoff, but it provides significant speed improvements.
