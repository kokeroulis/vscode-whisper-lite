import * as fs from 'node:fs';
import * as path from 'node:path';

const stylesheetFileName = 'TranscriptionWebView.css';
const clientScriptFileName = 'TranscriptionWebViewClient.js';

export type TranscriptionWebViewRenderOptions = {
  cspSource: string;
  nonce: string;
  styleUri: string;
  scriptUri: string;
};

export class TranscriptionWebView {
  private readonly htmlTemplate: string;

  constructor() {
    this.htmlTemplate = readViewAsset('TranscriptionWebView.html');
  }

  getStylesheetPath(): string {
    return getCompiledStylesheetPath();
  }

  getClientScriptPath(): string {
    return getCompiledClientScriptPath();
  }

  renderForWebview(webview: { cspSource: string }, styleUri: string, scriptUri: string): string {
    return this.render({
      cspSource: webview.cspSource,
      nonce: getNonce(),
      styleUri,
      scriptUri
    });
  }

  render(options: TranscriptionWebViewRenderOptions): string {
    return this.htmlTemplate
      .replaceAll('{{CSP_SOURCE}}', options.cspSource)
      .replaceAll('{{NONCE}}', options.nonce)
      .replace('{{STYLE_URI}}', options.styleUri)
      .replace('{{SCRIPT_URI}}', options.scriptUri);
  }
}

function getCompiledStylesheetPath(): string {
  return path.join(__dirname, stylesheetFileName);
}

function getCompiledClientScriptPath(): string {
  return path.join(__dirname, clientScriptFileName);
}

function readViewAsset(fileName: string): string {
  const candidates = [
    path.join(__dirname, fileName),
    path.join(process.cwd(), 'src', 'views', fileName)
  ];
  const assetPath = candidates.find((candidate: string): boolean => fs.existsSync(candidate));

  if (!assetPath) {
    throw new Error(`Could not find webview asset: ${fileName}`);
  }

  return fs.readFileSync(assetPath, 'utf8');
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
