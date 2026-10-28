'use strict';

const MODES = ['inline', 'editor', 'status'];
const position = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const validName = value => typeof value === 'string' && value.trim().length <= 80 && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value);

function validEntry(entry) {
  if (!entry || typeof entry.uri !== 'string') return false;
  try { return new URL(entry.uri).protocol === 'file:'; } catch { return false; }
}

class Library {
  constructor(saved, legacy) {
    const source = Array.isArray(saved?.books) ? saved.books : (validEntry(legacy) ? [legacy] : []);
    this.books = [];
    for (const entry of source) {
      if (!validEntry(entry) || this.books.some(item => item.uri === entry.uri)) continue;
      this.books.push({
        uri: entry.uri,
        name: validName(entry.name) ? entry.name.trim() || undefined : undefined,
        hash: typeof entry.hash === 'string' ? entry.hash : '',
        offset: position(entry.offset),
        length: position(entry.length),
        updatedAt: position(entry.updatedAt),
        bookmarks: (Array.isArray(entry.bookmarks) ? entry.bookmarks : []).filter(mark =>
          mark && Number.isSafeInteger(mark.offset) && mark.offset >= 0 && typeof mark.label === 'string' && mark.label.trim() && mark.label.length <= 80)
          .map(mark => ({ offset: mark.offset, label: mark.label.trim() })),
      });
    }
    const candidate = saved?.mode ?? legacy?.mode;
    this.mode = MODES.includes(candidate) ? candidate : 'inline';
    const current = saved?.currentUri ?? legacy?.uri;
    this.currentUri = this.books.some(item => item.uri === current) ? current : undefined;
  }

  get current() { return this.books.find(item => item.uri === this.currentUri); }

  add(uri, hash, length) {
    if (!validEntry({ uri })) throw new Error('请选择本机的文本文件。');
    if (this.books.some(item => item.uri === uri)) return false;
    this.books.push({ uri, hash, length, offset: 0, updatedAt: 0, bookmarks: [] });
    return true;
  }

  rename(uri, name) {
    const entry = this.books.find(item => item.uri === uri);
    if (!entry) throw new Error('书架中没有这本书，请刷新后重试。');
    if (!validName(name)) throw new Error('显示名称最多 80 个字符，不能包含换行或控制字符。');
    entry.name = name.trim() || undefined;
  }

  open(uri, hash, length) {
    let entry = this.books.find(item => item.uri === uri);
    const changed = Boolean(entry && entry.hash !== hash);
    if (!entry) {
      this.add(uri, hash, length);
      entry = this.books.find(item => item.uri === uri);
    }
    if (changed) { entry.offset = 0; entry.bookmarks = []; }
    Object.assign(entry, { hash, length, updatedAt: Date.now() });
    this.currentUri = uri;
    return { entry, changed };
  }

  addBookmark(label) {
    if (!this.current) throw new Error('请先打开一本本地文本。');
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80) throw new Error('书签名称需要 1–80 个字符。');
    const mark = { offset: this.current.offset, label: label.trim() };
    const existing = this.current.bookmarks.findIndex(item => item.offset === mark.offset);
    if (existing < 0) this.current.bookmarks.push(mark);
    else this.current.bookmarks[existing] = mark;
    this.current.bookmarks.sort((a, b) => a.offset - b.offset);
  }

  removeBookmark(offset) {
    if (this.current) this.current.bookmarks = this.current.bookmarks.filter(mark => mark.offset !== offset);
  }

  remove(uri) {
    this.books = this.books.filter(entry => entry.uri !== uri);
    if (this.currentUri === uri) this.currentUri = undefined;
  }

  snapshot() {
    return { version: 2, mode: this.mode, currentUri: this.currentUri,
      books: this.books.map(entry => ({ ...entry, bookmarks: entry.bookmarks.map(mark => ({ ...mark })) })) };
  }
}

module.exports = { Library, MODES };
