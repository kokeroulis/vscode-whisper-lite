const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs/promises');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index.cjs');
  const userDataDir = await fs.mkdtemp(path.join('/tmp', 'wl-smoke-'));
  const modelServer = await startModelServer();

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ['--disable-workspace-trust', `--user-data-dir=${userDataDir}`],
      extensionTestsEnv: {
        VSCODE_WHISPER_LITE_SMOKE_TEST: '1',
        VSCODE_WHISPER_LITE_MEDIUM_EN_MODEL_URL: modelServer.url
      }
    });
  } finally {
    await new Promise((resolve) => {
      modelServer.server.close(resolve);
    });
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
}

function startModelServer() {
  return new Promise((resolve, reject) => {
    const modelBytes = Buffer.from('smoke-test-medium-model');
    const server = http.createServer((request, response) => {
      if (request.url !== '/ggml-medium.en.bin') {
        response.writeHead(404);
        response.end();
        return;
      }

      response.writeHead(200, {
        'content-length': modelBytes.length,
        'content-type': 'application/octet-stream'
      });
      response.end(modelBytes);
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Smoke model server did not bind to a TCP port.'));
        return;
      }

      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/ggml-medium.en.bin`
      });
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
