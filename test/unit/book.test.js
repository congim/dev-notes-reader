'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Book, decodeText, statusText, parsePercent } = require('../../src/book');

test('decodes UTF-8 BOM, CRLF and Unicode line separators', () => {
  assert.equal(decodeText(Buffer.from('\ufeff第一章\r\n正文\r结尾\u2028下一行')), '第一章\n正文\n结尾\n下一行');
});

test('decodes UTF-16 BOMs and legacy GB18030', () => {
  assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('中文', 'utf16le')])), '中文');
  assert.equal(decodeText(Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x65, 0x87])), '中文');
  assert.equal(decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])), '中文');
});

test('rejects empty, binary and malformed input', () => {
  for (const bytes of [Buffer.from(' \n '), Buffer.from([0, 1, 2]), Buffer.from([0xff])]) {
    assert.throws(() => decodeText(bytes));
  }
  assert.throws(() => decodeText(Buffer.from([0xff]), 'utf-8'));
});

test('pagination preserves Unicode and blank paragraphs without an extra wrap line', () => {
  const book = new Book('甲😀乙丙\n\n丁戊', 2);
  assert.deepEqual(book.page(2), ['甲😀', '乙丙']);
  book.move(1, 2);
  assert.deepEqual(book.page(2), ['', '丁戊']);
  assert.equal(book.offset, 6);
  book.move(-1, 2);
  assert.deepEqual(book.page(2), ['甲😀', '乙丙']);
});

test('the final partial page moves back to the same preceding page', () => {
  const book = new Book('一二三四五六七八九', 2);
  book.move(1, 3);
  assert.deepEqual(book.page(3), ['七八', '九']);
  book.move(1, 3);
  assert.deepEqual(book.page(3), ['七八', '九']);
  book.move(-1, 3);
  assert.deepEqual(book.page(3), ['一二', '三四', '五六']);
  book.move(-1, 3);
  assert.equal(book.offset, 0);
});

test('restores a UTF-16 offset and anchors it after line width changes', () => {
  const book = new Book('甲😀乙丙丁戊', 2, 3);
  assert.deepEqual(book.page(1), ['乙丙']);
  const reflowed = new Book(book.text, 3, book.offset);
  assert.deepEqual(reflowed.page(1), ['甲😀乙']);
  assert.equal(new Book('一二三', 2, Infinity).offset, 0);
  assert.equal(new Book('一二三', 2, -10).offset, 0);
  assert.deepEqual(new Book('一二三', 2, 999).page(1), ['三']);
});

test('changing page size keeps the same current line', () => {
  const book = new Book('一二三四五六七八', 2);
  book.move(1, 1);
  assert.deepEqual(book.page(3), ['三四', '五六', '七八']);
  assert.deepEqual(book.page(1), ['三四']);
});

test('percentage jumps clamp to a readable line, including 100%', () => {
  const book = new Book('一二三四五六七八九十', 2);
  book.seekPercent(50);
  assert.deepEqual(book.page(1), ['五六']);
  book.seekPercent(100);
  assert.deepEqual(book.page(1), ['九十']);
  book.seekPercent(0);
  assert.equal(book.offset, 0);
  assert.throws(() => book.seekPercent(NaN));
  assert.throws(() => book.seekPercent(101));
});

test('percent input rejects blank and invalid numbers instead of jumping silently', () => {
  for (const input of ['', ' ', 'NaN', 'Infinity', '-1', '101', '1e2', '0x10', '五十']) {
    assert.equal(parsePercent(input), undefined);
  }
  assert.equal(parsePercent(' 12.5% '), 12.5);
  assert.equal(parsePercent('100'), 100);
});

test('status text cannot inject icons or multiline content', () => {
  assert.equal(statusText('甲 $(alert)\n乙\t丙'), '甲 ＄(alert) 乙 丙');
});

test('book validates layout limits and refuses empty content', () => {
  assert.throws(() => new Book('', 28));
  for (const width of [0, -1, Infinity, NaN, 1.5]) assert.throws(() => new Book('正文', width));
});

test('indexes Chinese, English and Markdown chapter headings at original offsets', () => {
  const text = '前言正文\n第一章 初遇\n第一章里的人正在说话，这是一段很长的正文。'.padEnd(120, '文') + '\nChapter 2: Night\n正文\n## 后记\n结束';
  const book = new Book(text, 8);
  assert.deepEqual(book.chapters.map(chapter => chapter.title), ['第一章 初遇', 'Chapter 2: Night', '后记']);
  assert.equal(book.chapters[0].offset, 5);
  assert.equal(book.chapters[1].offset, 121);
  book.moveChapter(1);
  assert.equal(book.offset, 5);
  book.moveChapter(1);
  assert.equal(book.offset, 121);
  book.moveChapter(-1);
  assert.equal(book.offset, 5);
});

test('literal search preserves UTF-16 offsets and does not execute regex syntax', () => {
  const book = new Book('😀长安\n[灯]与长安\n长安', 8);
  assert.deepEqual(book.search('长安').matches.map(match => match.offset), [2, 9, 12]);
  assert.equal(book.search('[灯]').matches[0].offset, 5);
  assert.deepEqual(book.search('.*').matches, []);
  assert.deepEqual(book.search('   ').matches, []);
  assert.equal(book.offset, 0, 'search must not move the reading cursor');
});

test('current chapter follows the reading position including preface and last chapter', () => {
  const text = '书前说明\n第一章 开始\n正文甲乙\n第二章 重逢\n正文丙丁';
  const book = new Book(text, 3);
  assert.equal(book.chapterIndex, -1);
  book.seek(text.indexOf('第一章'));
  assert.equal(book.chapterIndex, 0);
  book.seek(text.indexOf('正文甲'));
  assert.equal(book.chapterIndex, 0);
  book.seek(text.length);
  assert.equal(book.chapterIndex, 1);
  assert.equal(new Book('没有标题的正文').chapterIndex, -1);
});

test('search bounds result count and reports truncation', () => {
  const results = new Book('甲乙'.repeat(250), 8).search('甲');
  assert.equal(results.matches.length, 200);
  assert.equal(results.truncated, true);
  assert.equal(new Book('甲乙', 8).search('甲').truncated, false);
});
