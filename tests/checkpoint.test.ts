import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { serializeChapterLine, parseCheckpoint, assembleBible } from '../scripts/generateBible.js';
import type { Book } from '../data/books.js';

// Minimal book fixtures (only the fields assembleBible reads).
const book = (bookIndex: number, name: string, chapterCount: number): Book => ({
  name, fullName: name, urlKey: name.toLowerCase(), abbreviations: [], bookIndex, chapterCount,
});

describe('checkpoint helpers', () => {
  it('round-trips a chapter through serialize -> parse, preserving null verses', () => {
    const verses = ['In the beginning...', null, 'third verse'];
    const line = serializeChapterLine(1, 1, verses);
    assert.ok(line.endsWith('\n'));

    const done = parseCheckpoint(line);
    assert.deepEqual(done.get('1:1'), verses);
  });

  it('parses multiple records keyed by "book:chapter"', () => {
    const text = serializeChapterLine(1, 1, ['a']) + serializeChapterLine(43, 8, [null, 'b']);
    const done = parseCheckpoint(text);
    assert.equal(done.size, 2);
    assert.deepEqual(done.get('1:1'), ['a']);
    assert.deepEqual(done.get('43:8'), [null, 'b']);
  });

  it('skips blank lines and a truncated final line (crash mid-write)', () => {
    const text = `${serializeChapterLine(1, 1, ['a'])}\n${'{"b":1,"c":2,"v":["b'}`; // last line truncated
    const done = parseCheckpoint(text);
    assert.equal(done.size, 1);
    assert.deepEqual(done.get('1:1'), ['a']);
    assert.equal(done.has('1:2'), false);
  });

  it('assembles ordered chapters into the bible shape', () => {
    const books = [book(1, 'Genesis', 2), book(2, 'Exodus', 1)];
    const results = new Map<string, (string | null)[]>([
      ['1:1', ['g1']], ['1:2', ['g2a', 'g2b']], ['2:1', ['e1']],
    ]);
    assert.deepEqual(assembleBible(results, books), {
      1: [['g1'], ['g2a', 'g2b']],
      2: [['e1']],
    });
  });

  it('throws if a chapter is missing during assembly', () => {
    const books = [book(1, 'Genesis', 2)];
    const results = new Map<string, (string | null)[]>([['1:1', ['g1']]]); // 1:2 missing
    assert.throws(() => assembleBible(results, books), /missing chapter Genesis 2/);
  });
});
