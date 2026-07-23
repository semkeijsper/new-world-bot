import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderPart, renderCitation, findBook } from '../events/messageReceived.js';
import bible, { bibleAvailable } from '../data/bible.js';
import books, { type Book } from '../data/books.js';
import versification from '../data/versification.js';

// These suites validate the downloaded NWT text (data/bible.json, gitignored).
// On a fresh clone the data is absent, so skip rather than fail — run
// `npm run scrape:bible` to download it and exercise them.
const skip = bibleAvailable ? false : 'data/bible.json not downloaded (run `npm run scrape:bible`)';

const gen = findBook('gen') as Book;
const john = findBook('john') as Book;
const ps = findBook('ps') as Book;

// ---------------------------------------------------------------------------
// renderPart — verse text for one normalized part
// ---------------------------------------------------------------------------
describe('renderPart', { skip }, () => {
  it('renders a single verse with its number marker', () => {
    assert.equal(
      renderPart(gen, '1:1'),
      '**1** In the beginning God created the heavens and the earth.',
    );
  });

  it('renders an in-chapter range, one marker per verse', () => {
    const out = renderPart(gen, '1:1-3');
    assert.match(out ?? '', /^\*\*1\*\* .+ \*\*2\*\* .+ \*\*3\*\* /);
    assert.equal(out, `**1** ${bible[1][0][0]} **2** ${bible[1][0][1]} **3** ${bible[1][0][2]}`);
  });

  it('renders a cross-chapter range, resetting verse numbers per chapter', () => {
    const out = renderPart(gen, '1:31-2:2') ?? '';
    assert.match(out, /^\*\*31\*\* /);          // last verse of chapter 1
    assert.match(out, / \*\*1\*\* /);           // chapter 2 restarts at 1
    assert.match(out, / \*\*2\*\* /);
  });

  it('returns undefined for a malformed part', () => {
    assert.equal(renderPart(gen, 'nonsense'), undefined);
    assert.equal(renderPart(gen, '1'), undefined);
  });

  it('returns undefined when a verse is absent from the cache', () => {
    assert.equal(renderPart(gen, '1:999'), undefined);
  });

  it('skips verses omitted from the NWT running text (John 7:53-8:11)', () => {
    assert.equal(renderPart(john, '8:1'), undefined);       // wholly omitted → nothing
    const out = renderPart(john, '8:10-13') ?? '';
    assert.doesNotMatch(out, /\*\*1[01]\*\*/);              // 10, 11 skipped
    assert.match(out, /^\*\*12\*\* /);                      // renders from 12
  });
});

// ---------------------------------------------------------------------------
// renderCitation — title + description for a full citation
// ---------------------------------------------------------------------------
describe('renderCitation', { skip }, () => {
  it('builds citation title from book name + range', () => {
    const r = renderCitation(gen, '1:1');
    assert.deepEqual(r, {
      citation: 'Genesis 1:1',
      text: '**1** In the beginning God created the heavens and the earth.',
    });
  });

  it('titles a range as written', () => {
    assert.equal(renderCitation(gen, '1:1-3')?.citation, 'Genesis 1:1-3');
    assert.equal(renderCitation(john, '3:16')?.citation, 'John 3:16');
  });

  it('combines comma-separated parts into one embed body', () => {
    const r = renderCitation(gen, '1:1, 3-5');
    assert.equal(r?.citation, 'Genesis 1:1, 3-5');
    // verses 1, 3, 4, 5 present; verse 2 skipped
    assert.match(r?.text ?? '', /^\*\*1\*\* .*\*\*3\*\* .*\*\*4\*\* .*\*\*5\*\* /);
    assert.doesNotMatch(r?.text ?? '', /\*\*2\*\*/);
  });

  it('returns undefined for an unrenderable citation', () => {
    assert.equal(renderCitation(ps, '23'), undefined);    // chapterless multi-chapter book
    assert.equal(renderCitation(gen, '99:1'), undefined); // out of range
    assert.equal(renderCitation(john, '8:1-11'), undefined); // wholly omitted passage
  });

  it('truncates an over-long body to 4096 chars with an ellipsis', () => {
    const r = renderCitation(ps, '119:1-176'); // longest chapter, well over 4096 chars
    assert.ok(r);
    assert.ok(r.text.length <= 4096);
    assert.ok(r.text.endsWith('...'));
  });
});

// ---------------------------------------------------------------------------
// Data integrity — the whole cache is well-formed and matches versification
// ---------------------------------------------------------------------------
describe('bible.json integrity', { skip }, () => {
  it('has all 66 books', () => {
    assert.equal(Object.keys(bible).length, 66);
  });

  it('every chapter/verse count matches the NWT versification', () => {
    for (const book of books) {
      const chapters = bible[book.bookIndex];
      assert.equal(chapters.length, book.chapterCount, `${book.name} chapter count`);
      for (let c = 0; c < chapters.length; c += 1) {
        assert.equal(chapters[c].length, versification[book.bookIndex][c],
          `${book.name} ${c + 1} verse count`);
      }
    }
  });

  it('every present verse is clean, non-empty text (null = omitted passage)', () => {
    for (const book of books) {
      for (const chapter of bible[book.bookIndex]) {
        for (const verse of chapter) {
          if (verse === null) {
            continue; // omitted from the NWT running text
          }
          assert.ok(verse.length > 0, 'non-empty');
          assert.equal(verse, verse.trim(), 'trimmed');
          assert.doesNotMatch(verse, /\s{2}/, 'no double spaces');
          assert.doesNotMatch(verse, /\n/, 'no newlines');
          assert.doesNotMatch(verse, /\*\*/, 'no leftover markers');
        }
      }
    }
  });

  it('omits John 7:53-8:11 (verses 1-11 absent, 12 present)', () => {
    const john8 = bible[43][7];
    for (let v = 1; v <= 11; v += 1) {
      assert.equal(john8[v - 1], null, `John 8:${v} should be omitted`);
    }
    assert.ok(john8[11] && john8[11].length > 0, 'John 8:12 present');
  });

  it('has no run-together words (missing space after punctuation, e.g. "way,Who")', () => {
    const offenders: string[] = [];
    for (const book of books) {
      const chapters = bible[book.bookIndex];
      for (let c = 0; c < chapters.length; c += 1) {
        for (let v = 0; v < chapters[c].length; v += 1) {
          const verse = chapters[c][v];
          if (verse !== null && /[a-z][,.;:!?][A-Z]/.test(verse)) {
            offenders.push(`${book.name} ${c + 1}:${v + 1}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `run-together verses: ${offenders.slice(0, 10).join(', ')}`);
  });
});
