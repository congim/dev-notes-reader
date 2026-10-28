'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-notes-persist-'));
  let child;
  const stop = () => { if (child && child.exitCode === null) child.kill('SIGTERM'); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const executable = process.env.VSCODE_EXECUTABLE_PATH || (process.platform === 'darwin'
      ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : await downloadAndUnzipVSCode());
    await fs.mkdir(path.join(root, 'profile', 'User'), { recursive: true });
    await fs.writeFile(path.join(root, 'profile', 'User', 'settings.json'), JSON.stringify({
      'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off', 'chat.disableAIFeatures': true,
    }));
    await fs.writeFile(path.join(root, 'story.txt'), Array.from({ length: 30 }, (_, i) => `段落${String(i + 1).padStart(2, '0')}：测试文本。`).join('\n'));
    await fs.writeFile(path.join(root, 'other.txt'), Array.from({ length: 30 }, (_, i) => `其他${String(i + 1).padStart(2, '0')}：独立位置。`).join('\n'));
    await fs.writeFile(path.join(root, 'shelf.txt'), '仅加入书架，尚未阅读。');
    for (const phase of ['write', 'resume']) {
      let log = '';
      child = spawn(executable, [
        `--user-data-dir=${path.join(root, 'profile')}`, `--extensions-dir=${path.join(root, 'extensions')}`,
        `--extensionDevelopmentPath=${path.resolve(__dirname, '..')}`,
        `--extensionDevelopmentPath=${path.join(__dirname, '..', 'test', 'integration', 'persistence-driver')}`,
        '--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--new-window',
      ], { env: { ...process.env, DEV_NOTES_PERSIST_ROOT: root, DEV_NOTES_PERSIST_PHASE: phase } });
      child.stdout.on('data', data => { log = (log + data).slice(-20000); });
      child.stderr.on('data', data => { log = (log + data).slice(-20000); });
      const timeout = setTimeout(stop, 45000);
      try {
        await new Promise((resolve, reject) => {
          child.on('error', reject);
          child.on('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`VS Code exited ${code ?? signal}\n${log}`)));
        });
      } finally {
        clearTimeout(timeout);
      }
      const result = JSON.parse(await fs.readFile(path.join(root, `${phase}.json`), 'utf8'));
      assert.equal(result.passed, true, result.error);
      console.log(`PASS persistence ${phase}: line ${result.restoredLine}; starts hidden; bookmarks and separate book progress`);
    }
    const database = new DatabaseSync(path.join(root, 'profile', 'User', 'globalStorage', 'state.vscdb'), { readOnly: true });
    try {
      const state = JSON.parse(database.prepare('SELECT value FROM ItemTable WHERE key = ?').get('local-dev-notes.dev-notes-reader').value);
      const entry = state.readingLibrary.books.find(book => book.uri.endsWith('/story.txt'));
      assert.equal(entry.name, '重启后的书名');
      assert.equal(entry.bookmarks[0].label, '重启后的定位');
      console.log('PASS persistence: renamed display name and bookmark remain on disk after both processes exit');
    } finally { database.close(); }
  } finally {
    stop();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
