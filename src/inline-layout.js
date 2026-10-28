'use strict';

function inlineLineNumbers(lineCount, activeLine, ranges, count) {
  if (!ranges.length) {
    const start = Math.max(0, Math.min(activeLine, lineCount - count));
    return Array.from({ length: Math.min(count, lineCount) }, (_, index) => start + index);
  }
  const visible = new Set();
  for (const range of ranges) {
    for (let line = range.start.line; line <= Math.min(range.end.line, lineCount - 1); line++) visible.add(line);
  }
  const lines = [...visible].sort((a, b) => a - b);
  const index = Math.max(0, lines.indexOf(activeLine));
  const start = Math.min(index, Math.max(0, lines.length - count));
  return lines.slice(start, start + count);
}

function sourceColumns(text, tabSize) {
  let width = 0;
  // shortcut: alignment assumes narrow monospace source glyphs; use status mode for wide glyphs or wrapped code.
  for (const character of text) width += character === '\t' ? tabSize - width % tabSize : 1;
  return width;
}

module.exports = { inlineLineNumbers, sourceColumns };
