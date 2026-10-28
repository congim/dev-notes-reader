'use strict';

const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.activate = async function () {
  const root = process.env.DEV_NOTES_PERSIST_ROOT;
  if (!root) return;
  const phase = process.env.DEV_NOTES_PERSIST_PHASE;
  let result;
  try {
    await vscode.extensions.getExtension('local-dev-notes.dev-notes-reader').activate();
    await vscode.workspace.getConfiguration('devNotes').update('hideOnBlur', false, vscode.ConfigurationTarget.Global);
    const run = (name, ...args) => vscode.commands.executeCommand(`devNotes.${name}`, ...args);
    await run('setMode', 'editor');
    const uri = vscode.Uri.parse('dev-notes:/review-notes.ts');
    let doc = await vscode.workspace.openTextDocument(uri);
    assert.doesNotMatch(doc.getText(), /段落/);
    if (phase === 'write') {
      await run('open', vscode.Uri.file(path.join(root, 'story.txt')));
      await run('next');
      await run('addBookmark', '重启后的定位');
      await run('renameBook', vscode.Uri.file(path.join(root, 'story.txt')).toString(), '重启后的书名');
      const imported = await run('importBooks', [vscode.Uri.file(path.join(root, 'shelf.txt'))]);
      assert.equal(imported.added, 1);
      await run('open', vscode.Uri.file(path.join(root, 'other.txt')));
      await run('next');
      await run('open', vscode.Uri.file(path.join(root, 'story.txt')));
    } else {
      assert.equal(await run('toggle'), true);
    }
    for (let i = 0; i < 100; i++) {
      doc = await vscode.workspace.openTextDocument(uri);
      if (doc.getText().includes('段落13')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(doc.getText(), /段落13/);
    assert.doesNotMatch(doc.getText(), /段落01/);
    if (phase === 'resume') {
      await run('jump', 0);
      assert.equal(await run('bookmarks', 132), true, 'saved bookmark survives a new process');
      await run('open', vscode.Uri.file(path.join(root, 'other.txt')));
      doc = await vscode.workspace.openTextDocument(uri);
      for (let i = 0; i < 100 && !doc.getText().includes('其他13'); i++) await new Promise(resolve => setTimeout(resolve, 50));
      assert.match(doc.getText(), /其他13/);
      assert.doesNotMatch(doc.getText(), /其他01/);
      assert.equal(await run('readBook', vscode.Uri.file(path.join(root, 'shelf.txt')).toString()), true,
        'an unread imported book survives a new process');
      await run('open', vscode.Uri.file(path.join(root, 'story.txt')));
    }
    await run('hide');
    result = { phase, passed: true, restoredLine: 13, startsHidden: true, bookmarksAndSecondBook: true };
  } catch (error) {
    result = { phase, passed: false, error: error.stack };
  } finally {
    await fs.writeFile(path.join(root, `${phase}.json`), JSON.stringify(result));
    await vscode.commands.executeCommand('workbench.action.quit');
  }
};
