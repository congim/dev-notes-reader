'use strict';

const vscode = require('vscode');
const path = require('node:path');
const { statusText } = require('./book');

const bookTitle = entry => statusText(entry.name || path.basename(vscode.Uri.parse(entry.uri).fsPath));
const progress = entry => Math.min(100, Math.floor(entry.offset / Math.max(1, entry.length) * 100));

class BookshelfProvider {
  constructor(library) {
    this.library = library;
    this.exposed = false;
    this.revision = 0;
    this.changes = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.changes.event;
  }

  setExposed(value) {
    this.exposed = value;
    this.refresh();
  }

  refresh() {
    this.revision++;
    this.changes.fire();
  }

  getChildren() {
    return this.exposed ? [...this.library.books].sort((a, b) => b.updatedAt - a.updatedAt) : [];
  }

  async getTreeItem(entry) {
    const revision = this.revision;
    const uri = vscode.Uri.parse(entry.uri);
    let available = true;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      available = !(stat.type & vscode.FileType.Directory);
    } catch { available = false; }
    // A pending file check must never restore a title after the user hides the shelf.
    if (!this.exposed || revision !== this.revision || !this.library.books.includes(entry)) return new vscode.TreeItem('已隐藏');
    const item = new vscode.TreeItem(bookTitle(entry), vscode.TreeItemCollapsibleState.None);
    item.id = entry.uri;
    item.description = `${progress(entry)}% · ${entry.bookmarks.length} 书签`
      + (entry.uri === this.library.currentUri ? ' · 当前' : '') + (available ? '' : ' · 文件不可用');
    item.tooltip = `${bookTitle(entry)}\n${uri.fsPath}\n${item.description}\n`
      + (entry.updatedAt ? `最近阅读：${new Date(entry.updatedAt).toLocaleString()}\n` : '尚未阅读\n')
      + (available ? '点击继续阅读；右键管理' : '文件可能已移动、删除或无权访问；放回原路径后刷新。记录已保留。');
    item.iconPath = new vscode.ThemeIcon(available ? 'book' : 'warning');
    item.contextValue = 'devNotes.book';
    item.command = { command: 'devNotes.readBook', title: '继续阅读', arguments: [entry.uri] };
    item.accessibilityInformation = { label: `${bookTitle(entry)}，${item.description}` };
    return item;
  }

  dispose() { this.changes.dispose(); }
}

module.exports = { BookshelfProvider, bookTitle };
