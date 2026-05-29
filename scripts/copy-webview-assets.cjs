const fs = require('node:fs/promises');
const path = require('node:path');

const assets = ['TranscriptionWebView.html', 'TranscriptionWebView.css'];

async function main() {
  const root = path.resolve(__dirname, '..');
  const sourceDir = path.join(root, 'src', 'views');
  const targetDir = path.join(root, 'out', 'views');

  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all(
    assets.map(async (asset) => {
      await fs.copyFile(path.join(sourceDir, asset), path.join(targetDir, asset));
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
