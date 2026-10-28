'use strict';

const { runTests } = require('@vscode/test-electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-notes-test-'));
  const localCode = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const executable = process.env.VSCODE_EXECUTABLE_PATH || (process.platform === 'darwin' ? localCode : undefined);
  // Keep test-electron from exiting before our finally removes the owned profile.
  const interrupted = () => { process.exitCode = 130; };
  const terminate = () => process.emit('SIGINT');
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', terminate);
  try {
    await runTests({
      ...(executable ? { vscodeExecutablePath: executable } : {}),
      extensionDevelopmentPath: path.resolve(__dirname, '..'),
      extensionTestsPath: path.join(__dirname, '..', 'test', 'integration', 'extension.test.js'),
      extensionTestsEnv: { DEV_NOTES_TEST_ROOT: root },
      launchArgs: [
        '--user-data-dir', path.join(root, 'profile'),
        '--extensions-dir', path.join(root, 'extensions'),
        '--disable-extensions', '--skip-welcome', '--skip-release-notes',
        '--disable-workspace-trust', '--new-window',
      ],
    });
  } finally {
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', terminate);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
