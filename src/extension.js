'use strict';

const vscode = require('vscode');
const { createHash } = require('node:crypto');
const { Book, decodeText, parsePercent, statusText } = require('./book');
const { Library, MODES } = require('./library');
const { inlineLineNumbers, sourceColumns } = require('./inline-layout');
const { BookshelfProvider, bookTitle } = require('./bookshelf-provider');
const READER_URI = vscode.Uri.parse('dev-notes:/review-notes.ts');
const MAX_BYTES = 20 * 1024 * 1024;
const EMPTY_DOCUMENT = '// No pending review notes.\nexport {};\n';
let flush = Promise.resolve();

function activate(context) {
  const legacy = context.globalState.get('lastReading');
  const library = new Library(context.globalState.get('readingLibrary'), legacy);
  let legacyPending = legacy !== undefined;
  let book;
  let mode = library.mode;
  let visible = false;
  let generation = 0;
  let picking = false;
  let saveWarningShown = false;
  let decoratedEditor;
  const prompts = new Set();
  const changes = new vscode.EventEmitter();
  const bookshelfProvider = new BookshelfProvider(library);
  const shelfView = vscode.window.createTreeView('devNotes.books', { treeDataProvider: bookshelfProvider, showCollapseAll: false });
  const decoration = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: { color: new vscode.ThemeColor('editorCodeLens.foreground'), margin: '0 0 0 2em' },
  });
  const status = vscode.window.createStatusBarItem('devNotes.line', vscode.StatusBarAlignment.Right, -100);
  status.name = 'Dev Notes Reader';
  status.command = 'devNotes.next';
  status.tooltip = process.platform === 'darwin'
    ? '点击下一段 · ⌘⌥← / ⌘⌥→ 翻页 · ⌃⌥H 隐藏 · ⌘⌥K 操作菜单'
    : '点击下一段 · Ctrl+Alt+← / Ctrl+Alt+→ 翻页 · Ctrl+Alt+H 隐藏 · Ctrl+Alt+K 操作菜单';
  const chapterStatus = vscode.window.createStatusBarItem('devNotes.chapters', vscode.StatusBarAlignment.Right, -99);
  chapterStatus.name = 'Dev Notes Reader · 章节目录';
  chapterStatus.command = 'devNotes.chapters';
  chapterStatus.tooltip = process.platform === 'darwin' ? '浏览章节 · ⌃⌥T' : '浏览章节 · Ctrl+Alt+T';
  chapterStatus.accessibilityInformation = { label: 'Dev Notes Reader：浏览章节目录', role: 'button' };
  const config = () => vscode.workspace.getConfiguration('devNotes');
  const settingNumber = (key, fallback, min, max) => {
    const value = config().get(key, fallback);
    return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const lineLength = () => settingNumber('lineLength', 28, 8, 80);
  const pageSize = () => mode === 'editor' ? settingNumber('pageLines', 12, 3, 40)
    : mode === 'inline' ? Math.max(1, inlineRows(vscode.window.activeTextEditor).length) : 1;
  const isCurrent = ticket => visible && generation === ticket;
  const percent = (offset, length) => Math.floor(offset / Math.max(1, length) * 100);
  const title = bookTitle;

  function captureProgress() {
    library.mode = mode;
    if (book && library.current) library.current.offset = book.offset;
  }

  function save() {
    captureProgress();
    bookshelfProvider.refresh();
    const snapshot = library.snapshot();
    flush = flush.then(async () => {
      await context.globalState.update('readingLibrary', snapshot);
      if (legacyPending) {
        await context.globalState.update('lastReading', undefined);
        legacyPending = false;
      }
    }).catch(() => {
      if (!saveWarningShown) {
        saveWarningShown = true;
        void vscode.window.showWarningMessage('Dev Notes Reader：无法保存进度，请检查 VS Code 用户数据目录的写入权限。');
      }
    });
    return flush;
  }

  function prompt(kind, options) {
    const input = kind === 'pick' ? vscode.window.createQuickPick() : vscode.window.createInputBox();
    const { validate, ...properties } = options;
    Object.assign(input, properties);
    if (kind === 'pick') input.matchOnDescription = true;
    prompts.add(input);
    return new Promise(resolve => {
      let done = false;
      const subscriptions = [];
      const finish = result => {
        if (done) return;
        done = true;
        prompts.delete(input);
        subscriptions.forEach(item => item.dispose());
        input.dispose();
        resolve(result);
      };
      subscriptions.push(input.onDidHide(() => finish(undefined)), input.onDidAccept(() => {
        if (kind === 'pick') {
          if (input.selectedItems[0]) finish(input.selectedItems[0]);
        } else {
          input.validationMessage = validate?.(input.value);
          if (!input.validationMessage) finish(input.value);
        }
      }));
      input.show();
    });
  }

  function closePrompts() { for (const input of [...prompts]) input.hide(); }

  function clearInline() {
    if (decoratedEditor) {
      decoratedEditor.setDecorations(decoration, []);
      decoratedEditor = undefined;
    }
  }

  function showStatus() {
    status.text = statusText(book.page(1)[0]);
    status.accessibilityInformation = { label: status.text, role: 'button' };
    status.show();
  }

  function inlineRows(editor) {
    if (!editor || !['file', 'untitled', 'vscode-remote'].includes(editor.document.uri.scheme)) return [];
    return inlineLineNumbers(editor.document.lineCount, editor.selection.active.line, editor.visibleRanges,
      settingNumber('inlineLines', 6, 1, 12));
  }

  function renderInline() {
    clearInline();
    if (!visible || mode !== 'inline' || !book) return;
    const editor = vscode.window.activeTextEditor;
    const rows = inlineRows(editor);
    if (!rows.length) {
      showStatus();
      return;
    }
    status.hide();
    const prefix = ['python', 'shellscript', 'ruby', 'yaml', 'powershell'].includes(editor.document.languageId) ? '# ' : '// ';
    const lines = rows.map(row => editor.document.lineAt(row));
    const tabSize = Number(editor.options.tabSize) || 4;
    const widths = lines.map(line => sourceColumns(line.text, tabSize));
    const column = Math.max(...widths) + 4;
    editor.setDecorations(decoration, book.page(rows.length).map((text, index) => ({
      range: lines[index].range,
      renderOptions: { after: { contentText: prefix + statusText(text), margin: `0 0 0 ${column - widths[index]}ch` } },
    })));
    decoratedEditor = editor;
  }

  function documentContent() {
    if (!visible || mode !== 'editor' || !book) return EMPTY_DOCUMENT;
    return '// Internal review notes\n\nexport function reviewNotes(): void {\n'
      + book.page(pageSize()).map(line => `  // ${line}`).join('\n') + '\n}\n';
  }

  async function closeReaderTabs() {
    const tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab =>
      tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === READER_URI.scheme);
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
  }

  function markVisible(value) {
    visible = value;
    if (!value) chapterStatus.hide();
    void vscode.commands.executeCommand('setContext', 'devNotes.visible', value);
    changes.fire(READER_URI);
  }

  async function hide() {
    const wasVisible = visible;
    generation++;
    markVisible(false);
    closePrompts();
    clearInline();
    status.hide();
    exposeShelf(false);
    await closeReaderTabs();
    if (wasVisible) await save();
    return true;
  }

  async function render(ticket, reveal = false) {
    if (!isCurrent(ticket) || !book) return false;
    const chapter = book.chapterIndex;
    chapterStatus.text = '$(list-tree) 目录' + (book.chapters.length
      ? ` ${chapter < 0 ? '' : chapter + 1 + '/'}${book.chapters.length}` : '');
    chapterStatus.show();
    changes.fire(READER_URI);
    clearInline();
    if (mode !== 'editor') {
      await closeReaderTabs();
      if (!isCurrent(ticket)) return false;
      if (mode === 'inline') renderInline();
      else showStatus();
      return true;
    }
    status.hide();
    const document = await vscode.workspace.openTextDocument(READER_URI);
    if (!isCurrent(ticket)) return false;
    if (reveal) {
      const editor = await vscode.window.showTextDocument(document, { preview: false });
      // A hide may arrive while VS Code is opening the editor; it must win.
      if (!isCurrent(ticket)) {
        changes.fire(READER_URI);
        await closeReaderTabs();
        return false;
      }
      editor.selection = new vscode.Selection(0, 0, 0, 0);
      editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    }
    return true;
  }

  async function readText(uri) {
    if (!(uri instanceof vscode.Uri) || uri.scheme !== 'file') throw new Error('请选择本机的文本文件。');
    let bytes;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) throw new Error('directory');
      if (stat.size > MAX_BYTES) throw new Error('too-large');
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch (error) {
      if (error.message === 'too-large') throw new Error('文件超过 20 MiB，请先拆分为较小的文本文件。');
      throw new Error('无法读取文件，请检查文件是否存在，以及是否有读取权限。书架记录已保留。');
    }
    if (bytes.length > MAX_BYTES) throw new Error('文件超过 20 MiB，请先拆分为较小的文本文件。');
    return decodeText(bytes, config().get('encoding', 'auto'));
  }

  async function open(uri) {
    const ticket = ++generation;
    closePrompts();
    if (uri === undefined) {
      markVisible(false);
      clearInline();
      status.hide();
      await closeReaderTabs();
      if (ticket !== generation) return false;
      picking = true;
      try {
        [uri] = await vscode.window.showOpenDialog({
          canSelectMany: false, canSelectFolders: false, openLabel: '导入文本',
          filters: { '文本文件': ['txt', 'md', 'text'], '所有文件': ['*'] },
        }) || [];
      } finally { picking = false; }
      if (!uri) return false;
    }
    if (ticket !== generation) return false;
    let text;
    try { text = await readText(uri); }
    catch (error) { if (ticket !== generation) return false; throw error; }
    if (ticket !== generation) return false;
    const hash = createHash('sha256').update(text).digest('hex');
    if (!vscode.window.state.focused && config().get('hideOnBlur', true)) { await hide(); return false; }
    captureProgress();
    const { entry, changed } = library.open(uri.toString(), hash, text.length);
    book = new Book(text, lineLength(), entry.offset);
    markVisible(true);
    const displayed = await render(ticket, true);
    await save();
    if (displayed && changed) void vscode.window.showInformationMessage('Dev Notes Reader：文本内容已变化，已重置该文件的进度和书签。');
    return displayed;
  }

  async function toggle() {
    if (visible) return hide();
    if (!book) return open(library.current ? vscode.Uri.parse(library.current.uri) : undefined);
    const ticket = ++generation;
    markVisible(true);
    return render(ticket, true);
  }

  async function setMode(value) {
    const ticket = generation;
    if (value === undefined) {
      const choice = await prompt('pick', { title: 'Dev Notes Reader · 选择阅读模式', items: [
        { label: '随行阅读', description: '真实代码行末，边写边看', mode: 'inline' },
        { label: '状态栏', description: '右下角短句', mode: 'status' },
        { label: '注释页', description: '独立的只读代码页', mode: 'editor' },
      ] });
      if (!choice || ticket !== generation) return false;
      value = choice.mode;
    }
    if (!MODES.includes(value)) throw new Error('请选择随行阅读、注释页或状态栏。');
    mode = value;
    const nextTicket = ++generation;
    closePrompts();
    clearInline();
    if (visible) await render(nextTicket, true);
    await save();
    return true;
  }

  async function startInline() {
    const changing = setMode('inline');
    const ticket = generation;
    await changing;
    if (ticket !== generation) return false;
    return visible ? true : toggle();
  }

  async function move(direction, chapter = false) {
    if (!visible || !book) return false;
    if (chapter && !book.moveChapter(direction)) return false;
    if (!chapter) book.move(direction, pageSize());
    await render(generation);
    await save();
    return true;
  }

  async function navigate(offset, ticket) {
    if (!isCurrent(ticket) || !book) return false;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > book.text.length) throw new Error('定位位置无效。');
    book.seek(offset);
    await render(ticket);
    await save();
    return true;
  }

  async function jump(value) {
    if (!visible || !book) return false;
    const ticket = generation;
    if (value === undefined) value = await prompt('input', {
      title: 'Dev Notes Reader · 跳转进度', prompt: '百分比（0–100）', value: String(percent(book.offset, book.text.length)),
      validate: input => parsePercent(input) === undefined ? '请输入 0 到 100 之间的数字。' : undefined,
    });
    if (value === undefined || !isCurrent(ticket)) return false;
    const amount = parsePercent(value);
    if (amount === undefined) throw new Error('请输入 0 到 100 之间的数字。');
    return navigate(Math.floor(book.text.length * amount / 100), ticket);
  }

  async function shelf(remove = false) {
    const ticket = generation;
    captureProgress();
    const items = [...library.books].sort((a, b) => b.updatedAt - a.updatedAt).map(entry => ({
      label: title(entry), description: `${percent(entry.offset, entry.length)}%${entry.uri === library.currentUri ? ' · 当前' : ''}`,
      detail: vscode.Uri.parse(entry.uri).fsPath, uri: entry.uri,
    }));
    if (!remove) items.unshift({ label: '$(add) 导入并阅读本地文本', import: true });
    if (!items.length) return false;
    const choice = await prompt('pick', { title: remove ? 'Dev Notes Reader · 从书架移除书籍' : 'Dev Notes Reader · 快速切换书籍', items });
    if (!choice || ticket !== generation) return false;
    if (remove) return removeBook(choice.uri);
    return open(choice.import ? undefined : vscode.Uri.parse(choice.uri));
  }

  function exposeShelf(value) {
    bookshelfProvider.setExposed(value);
    void vscode.commands.executeCommand('setContext', 'devNotes.shelfVisible', value);
    shelfView.message = value ? '点击继续阅读 · 右键管理 · ＋ 批量导入' : undefined;
  }

  async function showShelf() {
    const ticket = generation;
    captureProgress();
    exposeShelf(true);
    await vscode.commands.executeCommand('devNotes.books.focus');
    return ticket === generation;
  }

  function shelfEntry(target) {
    const uri = typeof target === 'string' ? target : target?.uri;
    const entry = library.books.find(item => item.uri === uri);
    if (!entry) throw new Error('书架中没有这本书，请刷新后重试。');
    return entry;
  }

  async function importBooks(uris) {
    const ticket = generation;
    if (uris === undefined) {
      picking = true;
      try {
        uris = await vscode.window.showOpenDialog({ canSelectMany: true, canSelectFolders: false,
          openLabel: '加入书架', filters: { '文本文件': ['txt', 'md', 'text'] } });
      } finally { picking = false; }
    }
    if (!uris || ticket !== generation) return false;
    if (!vscode.window.state.focused && config().get('hideOnBlur', true)) { await hide(); return false; }
    if (!Array.isArray(uris)) throw new Error('请选择本机的文本文件。');
    const result = { added: 0, skipped: 0, failed: [] };
    for (const uri of uris) {
      if (ticket !== generation) return false;
      try {
        if (!(uri instanceof vscode.Uri) || uri.scheme !== 'file') throw new Error('请选择本机的文本文件。');
        if (library.books.some(entry => entry.uri === uri.toString())) { result.skipped++; continue; }
        const text = await readText(uri);
        if (ticket !== generation) return false;
        if (library.add(uri.toString(), createHash('sha256').update(text).digest('hex'), text.length)) {
          result.added++;
          await save();
        } else result.skipped++;
      } catch (error) {
        if (ticket !== generation) return false;
        result.failed.push({ file: uri instanceof vscode.Uri ? uri.fsPath : '', message: error.message });
      }
    }
    if (ticket !== generation) return false;
    exposeShelf(true);
    const summary = `Dev Notes Reader：已加入 ${result.added} 本，已有 ${result.skipped} 本，失败 ${result.failed.length} 本。`;
    if (result.failed.length) {
      void vscode.window.showWarningMessage(summary, '查看失败项').then(action => {
        if (action && ticket === generation && bookshelfProvider.exposed) return prompt('pick', {
          title: 'Dev Notes Reader · 未加入的文件', placeholder: '修正文件或编码后可重新导入；成功的书籍已保存。',
          items: result.failed.map(item => ({ label: statusText(item.file || '无效文件'), detail: item.message })),
        });
      });
    } else void vscode.window.showInformationMessage(summary);
    return result;
  }

  async function renameBook(target, name) {
    const entry = shelfEntry(target);
    const ticket = generation;
    if (name === undefined) name = await prompt('input', { title: 'Dev Notes Reader · 修改书籍显示名称',
      prompt: '只修改书架名称，留空恢复文件名；不会重命名原文件。', value: entry.name || title(entry),
      validate: value => value.trim().length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)
        ? '最多 80 个字符，不能包含换行或控制字符。' : undefined });
    if (name === undefined || ticket !== generation) return false;
    library.rename(entry.uri, name);
    await save();
    return true;
  }

  async function removeBook(target) {
    if (target === undefined) return shelf(true);
    const entry = shelfEntry(target);
    const ticket = generation;
    const choice = await prompt('pick', { title: `Dev Notes Reader · 移除「${title(entry)}」？`,
      placeholder: '只清除本书进度和书签，原文件保留。', items: [
        { label: '保留这本书', remove: false },
        { label: '移除记录', description: `清除 ${entry.bookmarks.length} 个书签和阅读进度`, remove: true },
      ] });
    if (!choice?.remove || ticket !== generation) return false;
    if (entry.uri === library.currentUri) return forget();
    library.remove(entry.uri);
    await save();
    return true;
  }

  async function chapters(offset) {
    if (!visible && !await toggle()) return false;
    if (!visible || !book) return false;
    const ticket = generation;
    if (!book.chapters.length) {
      void vscode.window.showInformationMessage('Dev Notes Reader：未识别到独立章节标题，可使用全文搜索或百分比跳转。');
      return false;
    }
    const current = book.chapterIndex;
    const items = book.chapters.map((item, index) => ({
      label: statusText(item.title),
      description: `${index + 1} · ${percent(item.offset, book.text.length)}%${index === current ? ' · 当前' : ''}`,
      offset: item.offset,
    }));
    const selected = offset === undefined ? await prompt('pick', {
      title: `Dev Notes Reader · 章节目录（共 ${items.length} 章${current >= 0 ? '，当前第 ' + (current + 1) + ' 章' : ''}）`,
      placeholder: '输入章节名或序号筛选；↑↓ 浏览，Enter 跳转，Esc 取消',
      items, activeItems: [items[Math.max(0, current)]],
    }) : book.chapters.find(item => item.offset === offset);
    return selected ? navigate(selected.offset, ticket) : false;
  }

  async function search(query) {
    if (!visible || !book) return false;
    const ticket = generation;
    if (query === undefined) query = await prompt('input', { title: 'Dev Notes Reader · 全文搜索', prompt: '字面匹配，区分大小写',
      validate: value => !value.trim() || value.length > 200 ? '请输入 1–200 个字符。' : undefined });
    if (query === undefined || !isCurrent(ticket)) return false;
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('请输入 1–200 个字符。');
    const { matches, truncated } = book.search(query);
    if (!matches.length) { void vscode.window.showInformationMessage('Dev Notes Reader：没有匹配结果。'); return false; }
    if (matches.length === 1) return navigate(matches[0].offset, ticket);
    const choice = await prompt('pick', { title: `Dev Notes Reader · ${truncated ? '前 200 个' : matches.length + ' 个'}结果`, items: matches.map(item => ({
      label: item.excerpt, description: `${percent(item.offset, book.text.length)}%`, offset: item.offset,
    })) });
    return choice ? navigate(choice.offset, ticket) : false;
  }

  async function addBookmark(label) {
    if (!visible || !book) return false;
    const ticket = generation;
    const offset = book.offset;
    if (label === undefined) label = await prompt('input', { title: 'Dev Notes Reader · 添加书签', value: `位置 ${percent(offset, book.text.length)}%`,
      validate: value => !value.trim() || value.trim().length > 80 ? '名称需要 1–80 个字符。' : undefined });
    if (label === undefined || !isCurrent(ticket) || book.offset !== offset) return false;
    captureProgress();
    library.addBookmark(label);
    await save();
    return true;
  }

  async function bookmarks(offset, remove = false) {
    if (!visible || !book) return false;
    const ticket = generation;
    const marks = library.current.bookmarks;
    if (!marks.length) { void vscode.window.showInformationMessage('Dev Notes Reader：当前书籍还没有书签。'); return false; }
    const choice = offset === undefined ? await prompt('pick', { title: remove ? 'Dev Notes Reader · 删除书签' : 'Dev Notes Reader · 查看书签',
      items: marks.map(mark => ({ label: statusText(mark.label), description: `${percent(mark.offset, book.text.length)}%`, offset: mark.offset })) })
      : marks.find(mark => mark.offset === offset);
    if (!choice || !isCurrent(ticket)) return false;
    if (remove) { library.removeBookmark(choice.offset); await save(); return true; }
    return navigate(choice.offset, ticket);
  }

  async function forget() {
    const uri = library.currentUri;
    book = undefined;
    library.remove(uri);
    await hide();
    await save();
    return true;
  }

  async function menu() {
    const ticket = generation;
    const choice = await prompt('pick', { title: `Dev Notes Reader${book ? ' · ' + percent(book.offset, book.text.length) + '%' : ''}`, items: [
      { label: '$(code) 开始随行阅读', action: 'startInline' },
      { label: '$(library) 打开本地书架', action: 'shelf' },
      { label: '$(settings-gear) 打开阅读设置', action: 'settings' },
      { label: '$(list-tree) 章节目录', action: 'chapters' },
      { label: '$(layout) 选择阅读模式', action: 'setMode' },
      ...(book && visible ? [
        { label: '$(search) 全文搜索', action: 'search' },
        { label: '$(bookmark) 添加书签', action: 'addBookmark' },
        { label: '$(bookmarks) 查看书签', action: 'bookmarks' },
        { label: '$(trash) 删除书签', action: 'removeBookmark' },
        { label: '$(go-to-file) 跳转进度', action: 'jump' },
        { label: '$(eye-closed) 立即隐藏', action: 'hide' },
      ] : []),
      { label: '$(close) 从书架移除书籍', action: 'removeBook' },
    ] });
    return choice && ticket === generation ? handlers[choice.action]() : false;
  }

  const handlers = {
    open, toggle, hide, setMode, startInline, jump, forget, chapters, search, addBookmark, bookmarks, menu,
    importBooks, renameBook, removeBook,
    readBook: target => open(vscode.Uri.parse(shelfEntry(target).uri)),
    revealBook: target => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.parse(shelfEntry(target).uri)),
    settings: () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:local-dev-notes.dev-notes-reader'),
    refreshShelf: () => { captureProgress(); bookshelfProvider.refresh(); },
    switchMode: () => setMode(mode === 'editor' ? 'status' : 'editor'),
    shelf: showShelf, shelfQuickPick: () => shelf(), removeBookmark: offset => bookmarks(offset, true),
    next: () => move(1), previous: () => move(-1), nextChapter: () => move(1, true), previousChapter: () => move(-1, true),
  };
  const safely = handler => async (...args) => {
    try { return await handler(...args); }
    catch (error) {
      void vscode.window.showErrorMessage(`Dev Notes Reader：${error instanceof Error ? error.message : '操作未完成，请重试。'}`);
      return false;
    }
  };
  context.subscriptions.push(
    changes, status, chapterStatus, decoration, bookshelfProvider, shelfView, { dispose: closePrompts },
    vscode.workspace.registerTextDocumentContentProvider(READER_URI.scheme, { onDidChange: changes.event, provideTextDocumentContent: documentContent }),
    ...Object.entries(handlers).map(([name, handler]) => vscode.commands.registerCommand(`devNotes.${name}`, safely(handler))),
    vscode.window.onDidChangeWindowState(state => {
      if (!state.focused && !picking && (visible || prompts.size || bookshelfProvider.exposed) && config().get('hideOnBlur', true)) void safely(hide)();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => renderInline()),
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor === vscode.window.activeTextEditor) renderInline();
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges(event => {
      if (event.textEditor === vscode.window.activeTextEditor) renderInline();
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document === vscode.window.activeTextEditor?.document) renderInline();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (book && event.affectsConfiguration('devNotes')) {
        book = new Book(book.text, lineLength(), book.offset);
        void safely(async () => { await render(generation); await save(); })();
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (visible && mode === 'editor' && !vscode.window.tabGroups.all.some(group =>
        group.tabs.some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === READER_URI.scheme))) void safely(hide)();
    }),
  );
  markVisible(false);
  exposeShelf(false);
}

function deactivate() { return flush; }
module.exports = { activate, deactivate };
