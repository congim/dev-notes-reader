'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Library } = require('../../src/library');
const first = 'file:///books/first.txt';
const second = 'file:///books/second.txt';
const hash = 'a'.repeat(64);

test('migrates old progress without losing its mode or character offset', () => {
  const library = new Library(undefined, { uri: first, hash, offset: 123, mode: 'status' });
  assert.equal(library.mode, 'status');
  assert.equal(library.current.uri, first);
  library.open(first, hash, 1000);
  assert.equal(library.current.offset, 123);
});

test('stores independent positions and bookmarks per file across serialization', () => {
  let library = new Library();
  library.open(first, hash, 1000);
  library.current.offset = 240;
  library.addBookmark('重逢');
  library.open(second, hash, 500);
  library.current.offset = 80;
  library.mode = 'inline';
  library = new Library(JSON.parse(JSON.stringify(library.snapshot())));
  assert.equal(library.current.offset, 80);
  library.open(first, hash, 1000);
  assert.equal(library.current.offset, 240);
  assert.deepEqual(library.current.bookmarks, [{ offset: 240, label: '重逢' }]);
  assert.equal(library.mode, 'inline');
});

test('content changes reset only the changed book and invalidate old bookmarks', () => {
  const library = new Library();
  library.open(first, hash, 1000);
  library.current.offset = 10;
  library.addBookmark('旧位置');
  library.open(second, hash, 500);
  library.current.offset = 80;
  assert.equal(library.open(first, 'b'.repeat(64), 20).changed, true);
  assert.equal(library.current.offset, 0);
  assert.deepEqual(library.current.bookmarks, []);
  library.open(second, hash, 500);
  assert.equal(library.current.offset, 80);
});

test('bookmark labels are bounded, duplicate locations update, and removal is precise', () => {
  const library = new Library();
  library.open(first, hash, 1000);
  library.addBookmark('开头');
  library.addBookmark('新名称');
  assert.deepEqual(library.current.bookmarks, [{ offset: 0, label: '新名称' }]);
  assert.throws(() => library.addBookmark(' '));
  assert.throws(() => library.addBookmark('长'.repeat(81)));
  library.current.offset = 50;
  library.addBookmark('下一处');
  library.removeBookmark(0);
  assert.deepEqual(library.current.bookmarks, [{ offset: 50, label: '下一处' }]);
});

test('queued persistence snapshots do not change when live progress changes', () => {
  const library = new Library();
  library.open(first, hash, 1000);
  library.addBookmark('开头');
  const snapshot = library.snapshot();
  library.current.offset = 200;
  library.addBookmark('后面');
  assert.equal(snapshot.books[0].offset, 0);
  assert.equal(snapshot.books[0].bookmarks.length, 1);
});

test('malformed saved entries cannot crash startup or become remote file requests', () => {
  const library = new Library({ books: [null, { uri: 'https://example.com/a' }, { uri: first, offset: -3, bookmarks: [null, { offset: NaN }] }], mode: 'invalid', currentUri: first });
  assert.equal(library.books.length, 1);
  assert.equal(library.current.offset, 0);
  assert.deepEqual(library.current.bookmarks, []);
  assert.equal(library.mode, 'inline');
});

test('removing the current entry keeps other books and clears the active selection', () => {
  const library = new Library();
  library.open(first, hash, 1000);
  library.open(second, hash, 1000);
  library.remove(second);
  assert.equal(library.current, undefined);
  assert.deepEqual(library.books.map(book => book.uri), [first]);
});

test('adding a book to the shelf does not switch reading or reset an existing position', () => {
  const library = new Library();
  library.open(first, hash, 1000);
  library.current.offset = 240;
  library.addBookmark('保留');
  assert.equal(library.add(second, hash, 500), true);
  assert.equal(library.add(first, 'b'.repeat(64), 10), false);
  assert.equal(library.current.uri, first);
  assert.equal(library.current.offset, 240);
  assert.equal(library.current.bookmarks[0].label, '保留');
  assert.equal(library.books.length, 2);
  assert.throws(() => library.add('https://example.com/book', hash, 10));
});

test('display names survive reload and content changes without renaming the source', () => {
  let library = new Library();
  library.open(first, hash, 1000);
  library.rename(first, '  夜读  ');
  library = new Library(library.snapshot());
  library.open(first, 'b'.repeat(64), 900);
  assert.equal(library.current.name, '夜读');
  assert.equal(library.current.uri, first);
  assert.throws(() => library.rename(first, '长'.repeat(81)));
  assert.throws(() => library.rename(first, '一\n二'));
  assert.throws(() => library.rename(second, '不存在'));
  library.rename(first, '');
  assert.equal(library.current.name, undefined);
});

test('malformed saved display names are ignored', () => {
  const library = new Library({ books: [
    { uri: first, name: 123 }, { uri: second, name: '一\n二' },
  ] });
  assert.equal(library.books[0].name, undefined);
  assert.equal(library.books[1].name, undefined);
});
