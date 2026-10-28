'use strict';

const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const command = (name, ...args) => vscode.commands.executeCommand(`devNotes.${name}`, ...args);
const readerUri = vscode.Uri.parse('dev-notes:/review-notes.ts');
const readerTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
  .filter(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'dev-notes');

async function waitFor(check, message) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

exports.run = async function () {
  const root = process.env.DEV_NOTES_TEST_ROOT;
  const source = path.join(root, 'private-novel.txt');
  const sourceUri = vscode.Uri.file(source);
  let checks = 0;
  const check = async (name, body) => { await body(); checks++; console.log(`PASS ${name}`); };
  const extension = vscode.extensions.getExtension('local-dev-notes.dev-notes-reader');
  assert.ok(extension, 'extension discovered');
  await extension.activate();
  // Focus changes from other desktop apps must not race the core command tests.
  await vscode.workspace.getConfiguration('devNotes').update('hideOnBlur', false, vscode.ConfigurationTarget.Global);
  await command('setMode', 'editor');
  const doc = await vscode.workspace.openTextDocument(readerUri);
  const read = () => doc.getText();

  try {
    const content = Array.from({ length: 37 }, (_, i) => `段落${String(i + 1).padStart(2, '0')}：长安夜色与行路人。`).join('\n');
    await fs.writeFile(source, content);
    const workUri = vscode.Uri.file(path.join(root, 'work.ts'));
    await fs.writeFile(workUri.fsPath, 'export const keepOpen = true;\n');
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(workUri), { preview: false });

    await check('opens a local book under a neutral TypeScript tab', async () => {
      assert.equal(await command('open', sourceUri), true);
      await waitFor(() => read().includes('段落01'), 'first page displayed');
      assert.equal(doc.languageId, 'typescript');
      assert.equal(readerTabs()[0].label, 'review-notes.ts');
      assert.doesNotMatch(read(), /private-novel/);
    });
    await check('page forward and backward preserve position', async () => {
      await command('next');
      await waitFor(() => read().includes('段落13') && !read().includes('段落01'), 'second page');
      await command('previous');
      await waitFor(() => read().includes('段落01'), 'first page restored');
    });
    await check('status mode closes comment tabs and clears document text', async () => {
      assert.equal(await command('switchMode'), true);
      assert.equal(readerTabs().length, 0);
      await waitFor(() => !read().includes('段落'), 'status mode does not expose editor text');
      await command('next');
      await command('switchMode');
      await waitFor(() => read().includes('段落02'), 'status mode advances one line');
    });
    await check('hide clears every split reader while keeping user files open', async () => {
      await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
      assert.equal(readerTabs().length, 2);
      assert.equal(await command('hide'), true);
      await waitFor(() => !read().includes('段落'), 'hidden document cleared');
      assert.equal(readerTabs().length, 0);
      assert.ok(vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.input?.uri?.toString() === workUri.toString())));
    });
    await check('hidden navigation does not reveal content and resume keeps position', async () => {
      await command('next');
      assert.equal(readerTabs().length, 0);
      await command('toggle');
      await waitFor(() => read().includes('段落02'), 'resume same line');
    });
    await check('percent jump validates input and reaches last line', async () => {
      await command('jump', 100);
      await waitFor(() => read().includes('段落37') && !read().includes('段落36'), 'last line');
      assert.equal(await command('jump', -1), false);
      assert.equal(await command('jump', 'bad'), false);
      await command('jump', 0);
      await waitFor(() => read().includes('段落01'), 'jump start');
    });
    await check('invalid file leaves the existing reading position intact', async () => {
      const empty = vscode.Uri.file(path.join(root, 'empty.txt'));
      await fs.writeFile(empty.fsPath, '');
      assert.equal(await command('open', empty), false);
      assert.ok(read().includes('段落01'));
      assert.equal(await command('open', vscode.Uri.parse('https://example.com/book.txt')), false);
    });
    await check('immediate hide cancels in-flight import', async () => {
      const opening = command('open', sourceUri);
      const hiding = command('hide');
      await Promise.all([opening, hiding]);
      assert.equal(readerTabs().length, 0);
      await waitFor(() => !read().includes('段落'), 'canceled import stays hidden');
    });
    await check('source remains byte-for-byte unchanged and progress is saved', async () => {
      await command('toggle');
      await command('jump', 0);
      await command('next');
      await waitFor(() => read().includes('段落13'), 'saved second page');
      await command('hide');
      assert.equal(await fs.readFile(source, 'utf8'), content);
    });
    await check('inline mode keeps actual source editable and never saves novel text', async () => {
      const code = await vscode.workspace.openTextDocument(workUri);
      const editor = await vscode.window.showTextDocument(code, { preview: false });
      await command('setMode', 'inline');
      await command('toggle');
      assert.equal(readerTabs().length, 0);
      assert.equal(vscode.window.activeTextEditor.document.uri.toString(), workUri.toString());
      const original = code.getText();
      assert.equal(code.isDirty, false);
      await editor.edit(edit => edit.insert(new vscode.Position(1, 0), 'export const writtenWhileReading = 42;\n'));
      await command('next');
      await code.save();
      assert.equal(await fs.readFile(workUri.fsPath, 'utf8'), original + 'export const writtenWhileReading = 42;\n');
      await command('hide');
      assert.equal(code.isDirty, false);
      await command('setMode', 'editor');
      await command('toggle');
    });
    await check('immediate hide wins over starting inline mode', async () => {
      const starting = command('startInline');
      const hiding = command('hide');
      await Promise.all([starting, hiding]);
      assert.equal(await command('next'), false, 'a pending mode change must not restore hidden content');
      assert.equal(readerTabs().length, 0);
      await command('setMode', 'editor');
      await command('toggle');
    });
    await check('inline paging follows six visible rows and the configured row count', async () => {
      const multilineUri = vscode.Uri.file(path.join(root, 'inline-work.ts'));
      const codeText = Array.from({ length: 20 }, (_, i) => `const value${i} = ${i};`).join('\n');
      await fs.writeFile(multilineUri.fsPath, codeText);
      const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(multilineUri), { preview: false });
      await command('setMode', 'inline');
      await command('jump', 0);
      await command('next');
      await command('setMode', 'editor');
      await waitFor(() => read().includes('段落07') && !read().includes('段落06'), 'six rows advance without omissions');
      await vscode.window.showTextDocument(editor.document);
      await command('setMode', 'inline');
      await command('previous');
      await command('setMode', 'editor');
      await waitFor(() => read().includes('段落01'), 'previous returns to the same first page');
      await vscode.workspace.getConfiguration('devNotes').update('inlineLines', 8, vscode.ConfigurationTarget.Global);
      await vscode.window.showTextDocument(editor.document);
      editor.selection = new vscode.Selection(19, 0, 19, 0);
      editor.revealRange(editor.selection);
      await command('setMode', 'inline');
      await command('next');
      await command('setMode', 'editor');
      await waitFor(() => read().includes('段落09') && !read().includes('段落08'), 'eight rows fit even when cursor is on final code line');
      await vscode.workspace.getConfiguration('devNotes').update('inlineLines', undefined, vscode.ConfigurationTarget.Global);
      assert.equal(await fs.readFile(multilineUri.fsPath, 'utf8'), codeText);
    });
    await check('short code files advance only by the displayed rows', async () => {
      const shortUri = vscode.Uri.file(path.join(root, 'short.ts'));
      await fs.writeFile(shortUri.fsPath, 'const a = 1;\nconst b = 2;');
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(shortUri), { preview: false });
      await command('setMode', 'inline');
      await command('jump', 0);
      await command('next');
      await command('setMode', 'editor');
      await waitFor(() => read().includes('段落03') && !read().includes('段落02'), 'two source rows must not skip six novel rows');
    });
    await check('bookmarks and separate book progress survive switching', async () => {
      await command('jump', 0);
      await command('next');
      assert.equal(await command('addBookmark', '重逢'), true);
      const other = vscode.Uri.file(path.join(root, 'other.txt'));
      await fs.writeFile(other.fsPath, '另一本文本\n自己的进度');
      await command('open', other);
      await waitFor(() => read().includes('另一本文本'), 'other book');
      await command('open', sourceUri);
      await waitFor(() => read().includes('段落13') && !read().includes('段落01'), 'per-book position');
      await command('jump', 0);
      assert.equal(await command('bookmarks', content.indexOf('段落13')), true);
      await waitFor(() => read().includes('段落13'), 'bookmark restored');
      assert.equal(await command('removeBookmark', content.indexOf('段落13')), true);
      assert.equal(await command('bookmarks', content.indexOf('段落13')), false);
    });
    await check('search jumps to literal result and panic cancels an open picker', async () => {
      assert.equal(await command('search', '段落25'), true);
      await waitFor(() => read().includes('段落25') && !read().includes('段落24'), 'search match');
      const picker = command('search', '段落');
      await new Promise(resolve => setTimeout(resolve, 100));
      await command('hide');
      assert.equal(await picker, false);
      assert.equal(readerTabs().length, 0);
      await command('toggle');
    });
    await check('chapter commands navigate whole-book headings', async () => {
      const chapters = vscode.Uri.file(path.join(root, 'chapters.txt'));
      await fs.writeFile(chapters.fsPath, '第一章 开始\n正文甲\n第二章 再见\n正文乙');
      await command('open', chapters);
      assert.equal(await command('nextChapter'), true);
      await waitFor(() => read().includes('第二章') && !read().includes('第一章'), 'next chapter');
      assert.equal(await command('previousChapter'), true);
      await waitFor(() => read().includes('第一章'), 'previous chapter');
      await command('open', sourceUri);
    });
    await check('chapter selection resumes hidden reading and rejects stale picker results', async () => {
      const chapters = vscode.Uri.file(path.join(root, 'chapter-selection.txt'));
      const text = '第一章 开始\n正文甲\n第二章 重逢\n正文乙\n第三章 归途\n正文丙';
      await fs.writeFile(chapters.fsPath, text);
      await command('open', chapters);
      await command('hide');
      assert.equal(await command('chapters', text.indexOf('第二章')), true, 'directory selection works after hiding');
      await waitFor(() => read().includes('第二章') && !read().includes('第一章'), 'selected chapter is displayed');
      assert.equal(await command('chapters', 1), false, 'only indexed chapter locations are accepted');
      const picker = command('chapters');
      await new Promise(resolve => setTimeout(resolve, 100));
      await command('hide');
      assert.equal(await picker, false, 'hide cancels the directory');
      assert.equal(readerTabs().length, 0);
      const resuming = command('chapters');
      await command('hide');
      assert.equal(await resuming, false, 'hide also wins while a directory is resuming reading');
      assert.equal(readerTabs().length, 0);
      await command('open', sourceUri);
    });
    await check('changed content resets an obsolete bookmark', async () => {
      await fs.writeFile(source, '全新的内容\n不能沿用旧位置。');
      await command('open', sourceUri);
      await waitFor(() => read().includes('全新的内容'), 'changed book starts at beginning');
    });
    await check('forget clears reading state without deleting the source', async () => {
      await command('forget');
      await waitFor(() => !read().includes('全新的内容'), 'forgotten content cleared');
      assert.equal(readerTabs().length, 0);
      assert.equal(await fs.readFile(source, 'utf8'), '全新的内容\n不能沿用旧位置。');
      await command('open', sourceUri);
      await waitFor(() => read().includes('全新的内容'), 'reimport after forget starts at beginning');
    });
    await check('batch shelf import isolates failures and never switches the current book', async () => {
      const added = vscode.Uri.file(path.join(root, 'shelf-added.txt'));
      const invalid = vscode.Uri.file(path.join(root, 'shelf-empty.txt'));
      await fs.writeFile(added.fsPath, '书架里的新书\n下一段');
      await fs.writeFile(invalid.fsPath, '');
      const result = await command('importBooks', [added, invalid, sourceUri, added]);
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 2);
      assert.equal(result.failed.length, 1);
      assert.match(read(), /全新的内容/);
      assert.equal(await command('renameBook', added.toString(), '夜读'), true);
      assert.equal(await command('readBook', added.toString()), true);
      await waitFor(() => read().includes('书架里的新书'), 'shelf book can be opened');
      assert.equal(await fs.readFile(added.fsPath, 'utf8'), '书架里的新书\n下一段');
      await command('open', sourceUri);
    });
    await check('hide cancels a batch import before it can add or reveal a file', async () => {
      const canceled = vscode.Uri.file(path.join(root, 'canceled-batch.txt'));
      await fs.writeFile(canceled.fsPath, '不会导入');
      const importing = command('importBooks', [canceled]);
      await command('hide');
      assert.equal(await importing, false);
      assert.equal(await command('readBook', canceled.toString()), false);
      assert.equal(readerTabs().length, 0);
    });
    await check('book removal confirms, supports cancellation, and preserves the source and other books', async () => {
      const target = vscode.Uri.file(path.join(root, 'shelf-added.txt'));
      const canceling = command('removeBook', target.toString());
      await new Promise(resolve => setTimeout(resolve, 150));
      await command('hide');
      assert.equal(await canceling, false);
      assert.equal(await command('readBook', target.toString()), true);
      const removing = command('removeBook', target.toString());
      await new Promise(resolve => setTimeout(resolve, 150));
      await vscode.commands.executeCommand('workbench.action.quickOpenSelectNext');
      await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
      assert.equal(await removing, true);
      assert.equal(await command('readBook', target.toString()), false);
      assert.equal(await command('readBook', sourceUri.toString()), true);
      assert.equal(await fs.readFile(target.fsPath, 'utf8'), '书架里的新书\n下一段');
    });
    await check('native shelf shows metadata, keeps missing records and masks names on hide', async () => {
      const { Library } = require('../../src/library');
      const { BookshelfProvider } = require('../../src/bookshelf-provider');
      const library = new Library();
      library.open(sourceUri.toString(), 'hash', 100);
      library.current.offset = 25;
      library.addBookmark('这里');
      library.rename(sourceUri.toString(), '我的书');
      const missing = vscode.Uri.file(path.join(root, 'missing-book.txt')).toString();
      library.add(missing, 'hash', 100);
      const provider = new BookshelfProvider(library);
      try {
        assert.deepEqual(provider.getChildren(), []);
        provider.setExposed(true);
        assert.equal(provider.getChildren().length, 2);
        const item = await provider.getTreeItem(library.current);
        assert.equal(item.label, '我的书');
        assert.match(item.description, /25%/);
        assert.match(item.description, /1 书签/);
        assert.equal(item.command.command, 'devNotes.readBook');
        const absent = await provider.getTreeItem(library.books.find(entry => entry.uri === missing));
        assert.match(absent.description, /不可用/);
        const loading = provider.getTreeItem(library.current);
        provider.setExposed(false);
        assert.deepEqual(provider.getChildren(), []);
        assert.equal((await loading).label, '已隐藏');
        assert.equal(library.books.length, 2);
      } finally { provider.dispose(); }
    });
    console.log(`Extension Host: ${checks} checks passed`);
  } finally {
    await command('hide');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
};
