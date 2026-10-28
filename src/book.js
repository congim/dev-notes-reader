'use strict';

function decodeText(bytes, encoding = 'auto') {
  let text;
  if (encoding === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    else {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        encoding = 'gb18030';
      }
    }
  }
  if (text === undefined) {
    try {
      text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      throw new Error('无法解码文件，请在 Dev Notes Reader 设置中指定正确的文本编码。');
    }
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/u.test(text)) {
    throw new Error('文件不是可读取的纯文本，请先转换成 TXT。');
  }
  text = text.replace(/^\ufeff/u, '').replace(/\r\n?|[\u2028\u2029\f]/gu, '\n')
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '');
  if (!text.trim()) throw new Error('文件没有可读取的正文。');
  return text;
}

class Book {
  constructor(text, width = 28, offset = 0) {
    if (!text.trim()) throw new Error('文件没有可读取的正文。');
    if (!Number.isInteger(width) || width < 1) throw new Error('每行字数必须是正整数。');
    this.text = text;
    this.lines = [];
    let start = 0;
    let cursor = 0;
    let line = '';
    let count = 0;
    for (const character of text) {
      if (character === '\n') {
        this.lines.push({ start, text: line });
        start = cursor + 1;
        line = '';
        count = 0;
      } else {
        if (count === width) {
          this.lines.push({ start, text: line });
          start = cursor;
          line = '';
          count = 0;
        }
        line += character;
        count++;
      }
      cursor += character.length;
    }
    if (line) this.lines.push({ start, text: line });
    this.chapters = [];
    for (const match of text.matchAll(/^[^\n]{1,80}$/gmu)) {
      const raw = match[0].trim();
      const heading = /^#{1,3}\s+\S/u.test(raw);
      const title = raw.replace(/^#{1,3}\s+/u, '');
      // shortcut: headings are inferred from short standalone lines; use explicit markup for unusual chapter formats.
      if (heading || /^(?:第[0-9０-９〇零一二三四五六七八九十百千万两]+[章节回卷部篇集]|chapter\s+(?:\d+|[ivxlcdm]+)\b|(?:序章|序言|楔子|引子|尾声|终章|后记|番外)(?:\s|[:：、]|$))/iu.test(title)) {
        this.chapters.push({ title, offset: match.index });
      }
    }
    this.seek(Number.isFinite(offset) ? offset : 0);
  }

  get offset() { return this.lines[this.index].start; }

  get chapterIndex() { return this.chapters.findLastIndex(chapter => chapter.offset <= this.offset); }

  page(count) {
    return this.lines.slice(this.index, this.index + count).map(line => line.text);
  }

  move(direction, count) {
    if (direction < 0) this.index = Math.max(0, this.index - count);
    else if (this.index + count < this.lines.length) this.index += count;
  }

  seek(offset) {
    let low = 0;
    let high = this.lines.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (this.lines[middle].start <= offset) low = middle;
      else high = middle - 1;
    }
    this.index = low;
  }

  seekPercent(percent) {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('请输入 0 到 100 之间的百分比。');
    this.seek(Math.floor(this.text.length * percent / 100));
  }

  moveChapter(direction) {
    const chapter = direction > 0
      ? this.chapters.find(item => item.offset > this.offset)
      : this.chapters.findLast(item => item.offset < this.offset);
    if (chapter) this.seek(chapter.offset);
    return Boolean(chapter);
  }

  search(query) {
    const needle = String(query).trim();
    const matches = [];
    if (!needle) return { matches, truncated: false };
    let from = 0;
    for (;;) {
      const offset = this.text.indexOf(needle, from);
      if (offset < 0) return { matches, truncated: false };
      if (matches.length === 200) return { matches, truncated: true };
      const excerpt = Array.from(this.text.slice(offset, offset + 160)).slice(0, 60).join('');
      matches.push({ offset, excerpt: statusText(excerpt) });
      from = offset + needle.length;
    }
  }
}

function parsePercent(input) {
  const value = String(input).trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)%?$/u.test(value)) return undefined;
  const number = Number(value.replace('%', ''));
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : undefined;
}

function statusText(text) {
  return text.replace(/\$\(/gu, '＄(').replace(/\s+/gu, ' ').trim() || '·';
}

module.exports = { Book, decodeText, parsePercent, statusText };
