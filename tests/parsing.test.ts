import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findBook,
  buildQueryParts,
  parseBibleVerses,
  citationRegex,
} from '../events/messageReceived.js';
import books, { type Book } from '../data/books.js';

const gen = findBook('gen') as Book;
const rev = findBook('rev') as Book;
const oba = findBook('ob') as Book; // Obadiah, chapterCount 1
const phm = findBook('phm') as Book; // Philemon, chapterCount 1
const jude = findBook('jude') as Book; // chapterCount 1
const ps = findBook('ps') as Book; // Psalms, 150 chapters

// ---------------------------------------------------------------------------
// findBook — abbreviation / name matching
// ---------------------------------------------------------------------------
describe('findBook', () => {
  it('matches full lowercase name', () => {
    assert.equal(findBook('genesis')?.name, 'Genesis');
  });

  it('matches short abbreviations', () => {
    assert.equal(findBook('ge')?.name, 'Genesis');
    assert.equal(findBook('gen')?.name, 'Genesis');
  });

  it('matches numbered-book abbreviations (no space, digit-prefixed)', () => {
    assert.equal(findBook('1john')?.name, '1 John');
    assert.equal(findBook('1jo')?.name, '1 John');
    assert.equal(findBook('2co')?.name, '2 Corinthians');
    assert.equal(findBook('3jo')?.name, '3 John');
  });

  it('matches every abbreviation of every book', () => {
    for (const book of books) {
      for (const abbr of book.abbreviations) {
        assert.equal(findBook(abbr)?.name, book.name, `abbr ${abbr}`);
      }
    }
  });

  it('is case-sensitive on the raw input (caller must lowercase first)', () => {
    // findBook does no normalisation itself — parseBibleVerses lowercases.
    assert.equal(findBook('Gen'), undefined);
    assert.equal(findBook('GENESIS'), undefined);
  });

  it('returns undefined for unknown tokens', () => {
    assert.equal(findBook('xyz'), undefined);
    assert.equal(findBook(''), undefined);
    assert.equal(findBook('gene'), undefined);
  });

  it('has no duplicate abbreviation across books', () => {
    const seen = new Map<string, string>();
    for (const book of books) {
      for (const abbr of book.abbreviations) {
        assert.equal(seen.has(abbr), false, `duplicate abbr "${abbr}" (${seen.get(abbr)} & ${book.name})`);
        seen.set(abbr, book.name);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// buildQueryParts — normalising a chapter/verse fragment for one book
// ---------------------------------------------------------------------------
describe('buildQueryParts', () => {
  it('single verse', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1'), ['1:1']);
  });

  it('verse range within one chapter', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1-5'), ['1:1-5']);
  });

  it('cross-chapter range', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1-2:5'), ['1:1-2:5']);
  });

  it('multiple parts sharing an explicit chapter context', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1, 3-5'), ['1:1', '1:3-5']);
  });

  it('several comma-separated verses', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1, 2, 3'), ['1:1', '1:2', '1:3']);
  });

  it('two independent chapter:verse groups', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1-3, 2:4-6'), ['1:1-3', '2:4-6']);
  });

  it('collapses a same-verse range to a single verse', () => {
    assert.deepEqual(buildQueryParts(gen, '1:1-1:1'), ['1:1']);
  });

  // --- chapterless handling ---
  it('rejects a chapterless citation for a multi-chapter book', () => {
    assert.deepEqual(buildQueryParts(gen, '23'), []);
    assert.deepEqual(buildQueryParts(ps, '23'), []);
  });

  it('treats a bare number as a verse for a single-chapter book', () => {
    assert.deepEqual(buildQueryParts(oba, '1'), ['1:1']);
    assert.deepEqual(buildQueryParts(oba, '5'), ['1:5']);
    assert.deepEqual(buildQueryParts(phm, '6'), ['1:6']);
    assert.deepEqual(buildQueryParts(jude, '25'), ['1:25']);
  });

  // --- bounds ---
  it('validates the verse against the actual NWT chapter length', () => {
    assert.deepEqual(buildQueryParts(ps, '119:176'), ['119:176']); // Psalm 119 has 176
    assert.deepEqual(buildQueryParts(ps, '119:177'), []);
    assert.deepEqual(buildQueryParts(gen, '1:31'), ['1:31']);      // Genesis 1 has 31
    assert.deepEqual(buildQueryParts(gen, '1:32'), []);
    assert.deepEqual(buildQueryParts(ps, '117:2'), ['117:2']);     // shortest chapter, 2
    assert.deepEqual(buildQueryParts(ps, '117:3'), []);
    assert.deepEqual(buildQueryParts(rev, '22:21'), ['22:21']);    // Revelation 22 has 21
    assert.deepEqual(buildQueryParts(rev, '22:22'), []);
  });

  it('validates the end verse of a range against its own chapter length', () => {
    assert.deepEqual(buildQueryParts(rev, '22:1-21'), ['22:1-21']);
    assert.deepEqual(buildQueryParts(rev, '22:1-22'), []);
  });

  it('bounds a bare verse for a single-chapter book by its verse count', () => {
    assert.deepEqual(buildQueryParts(jude, '25'), ['1:25']); // Jude has 25 verses
    assert.deepEqual(buildQueryParts(jude, '26'), []);
    assert.deepEqual(buildQueryParts(oba, '21'), ['1:21']);  // Obadiah has 21 verses
    assert.deepEqual(buildQueryParts(oba, '22'), []);
  });

  // --- lower bounds ---
  it('rejects chapter or verse below 1', () => {
    assert.deepEqual(buildQueryParts(gen, '0:1'), []);
    assert.deepEqual(buildQueryParts(gen, '1:0'), []);
    assert.deepEqual(buildQueryParts(gen, '0:0'), []);
  });

  it('rejects a chapter beyond the book chapterCount', () => {
    assert.deepEqual(buildQueryParts(gen, '50:1'), ['50:1']); // Genesis has 50
    assert.deepEqual(buildQueryParts(gen, '51:1'), []);
  });

  it('rejects a cross-chapter range whose end chapter overflows', () => {
    assert.deepEqual(buildQueryParts(rev, '1:1-22:21'), ['1:1-22:21']); // Revelation has 22
    assert.deepEqual(buildQueryParts(rev, '1:1-23:1'), []);
  });

  // --- ordering guards ---
  it('rejects a descending chapter range', () => {
    assert.deepEqual(buildQueryParts(gen, '3:1-2:5'), []);
  });

  it('rejects a descending verse range within a chapter', () => {
    assert.deepEqual(buildQueryParts(gen, '5:10-3'), []);
  });

  it('allows a lower end-verse when the end chapter is higher', () => {
    // verseStart > verseEnd is permitted only across ascending chapters
    assert.deepEqual(buildQueryParts(gen, '2:5-3:1'), ['2:5-3:1']);
  });

  it('returns empty for a fragment with no digits', () => {
    assert.deepEqual(buildQueryParts(gen, 'abc'), []);
    assert.deepEqual(buildQueryParts(gen, ''), []);
  });
});

// ---------------------------------------------------------------------------
// parseBibleVerses — full regex extraction over free-form message text
// ---------------------------------------------------------------------------
describe('parseBibleVerses — basic formats', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('Gen 1:1', ['genesis 1:1']);
  t('Gen 1:1-5', ['genesis 1:1-5']);
  t('Gen 1:1-2:5', ['genesis 1:1-2:5']);
  t('Gen 1:1, 3-5', ['genesis 1:1, 3-5']);
  t('John 3:16,17,18', ['john 3:16,17,18']);
  t('Matt 5:3-10, 12', ['matthew 5:3-10, 12']);
  t('1 John 2:1', ['1 john 2:1']);
  t('Rev 22:21', ['revelation 22:21']);
});

describe('parseBibleVerses — book name variants', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('ge 1:1', ['genesis 1:1']);            // shortest abbreviation
  t('GEN 1:1', ['genesis 1:1']);           // uppercase
  t('gEn 1:1', ['genesis 1:1']);           // mixed case
  t('Php 4:13', ['philippians 4:13']);     // 3-letter abbr
  t('1John 2:1', ['1 john 2:1']);          // numbered, no space
  t('1Cor13:4', ['1 corinthians 13:4']);   // numbered, no spaces at all
  t('1 Cor 13:4-7', ['1 corinthians 13:4-7']);
  t('songofsol 1:1', ['song of solomon 1:1']); // multiword name via abbr
});

describe('parseBibleVerses — surrounding text & punctuation', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('John3:16', ['john 3:16']);                        // no space book/chapter
  t('Genesis1:1', ['genesis 1:1']);
  t('John 3:16.', ['john 3:16']);                      // trailing period
  t('John 3:16!', ['john 3:16']);
  t('(John 3:16)', ['john 3:16']);                     // parentheses
  t('"John 3:16"', ['john 3:16']);                     // quotes
  t('I love John 3:16 so much', ['john 3:16']);        // embedded in a sentence
  t('John 21:25 the end', ['john 21:25']);
  t('Read Gen 1:1-2:25 tonight', ['genesis 1:1-2:25']);
});

describe('parseBibleVerses — multiple citations in one message', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('John 3:16 and Rom 5:8', ['john 3:16', 'romans 5:8']);
  t('see Genesis 1:1; John 3:16 today', ['genesis 1:1', 'john 3:16']);
  t('Matt 1:1; Mark 1:1; Luke 1:1; John 1:1',
    ['matthew 1:1', 'mark 1:1', 'luke 1:1', 'john 1:1']);
});

describe('parseBibleVerses — single-chapter books', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('Obadiah 3', ['obadiah 3']);      // bare verse allowed (1 chapter)
  t('Obad 1:3', ['obadiah 1:3']);     // explicit chapter also allowed
  t('ob 5', ['obadiah 5']);
  t('Jude 5', ['jude 5']);
  t('Philemon 6', ['philemon 6']);
});

describe('parseBibleVerses — rejected / ignored input', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('hello world no verse', []);              // no citation
  t('abcdef 1:1', []);                         // unknown book
  t('x 1:1', []);                              // single unknown letter
  t('Ps 23', []);                              // chapterless, multi-chapter book
  t('John 1', []);                             // chapterless, multi-chapter book
  t('Ps 151:1', []);                           // chapter beyond Psalms (150)
  t('Gen 51:1', []);                           // chapter beyond Genesis (50)
  t('Ps 119:177', []);                         // verse beyond Psalm 119 length
  t('Gen 3:1-2:5', []);                        // descending range
  t('call me at 3:16', []);                    // "at" not a book, no chapter ctx
  t('Version 2:0', []);                        // "Version" not a book
  t('Gen 0:1', []);                            // chapter below 1
  t('Gen 1:0', []);                            // verse below 1
  t('Jude 26', []);                            // verse beyond Jude length (25)
  t('Gen 1:32', []);                           // verse beyond Genesis 1 length (31)
});

// Comma-separated chapter:verse groups now parse fully (previously the second
// group was truncated to a stray chapter number).
describe('parseBibleVerses — comma-separated chapter groups', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  t('Genesis 1:1-3, 2:4-6', ['genesis 1:1-3, 2:4-6']);
  t('gen 1:1-2:3, 5:5', ['genesis 1:1-2:3, 5:5']);
  t('John 3:16, 4:1', ['john 3:16, 4:1']);
  // Same-chapter verse lists must still work (comma is not a chapter break here).
  t('Gen 1:1, 3-5', ['genesis 1:1, 3-5']);
  t('John 3:16,17,18', ['john 3:16,17,18']);
});

// ---------------------------------------------------------------------------
// Known quirks — these encode CURRENT behaviour, not necessarily desired.
// ---------------------------------------------------------------------------
describe('parseBibleVerses — known quirks (regression guards)', () => {
  const t = (input: string, expected: string[]) =>
    it(JSON.stringify(input), () => assert.deepEqual(parseBibleVerses(input), expected));

  // Comma continuation across a numbered book is ambiguous with a verse list
  // (cf. "Gen 1:1, 3 and ..."), so "2 John 1" / "3 John 2" are still swallowed
  // as a bare number on the first book. Use ';' to separate such citations.
  t('1 John 1:1, 2 John 1, 3 John 2', ['1 john 1:1, 2']);
  t('1 John 1:1; 2 John 1; 3 John 2', ['1 john 1:1', '2 john 1', '3 john 2']);
});

// ---------------------------------------------------------------------------
// The extraction regex itself — structural sanity
// ---------------------------------------------------------------------------
describe('citationRegex', () => {
  it('is global + multiline so all citations across lines are found', () => {
    assert.ok(citationRegex.global);
    assert.ok(citationRegex.multiline);
  });

  it('finds citations spread across multiple lines', () => {
    assert.deepEqual(
      parseBibleVerses('Gen 1:1\nJohn 3:16\nRom 5:8'),
      ['genesis 1:1', 'john 3:16', 'romans 5:8'],
    );
  });

  it('exposes named groups BookName and ChaptersAndVerses', () => {
    const re = new RegExp(citationRegex.source, citationRegex.flags);
    const m = re.exec('1 John 2:1');
    assert.equal(m?.groups?.['BookName']?.trim(), '1 John');
    assert.equal(m?.groups?.['ChaptersAndVerses'], '2:1');
  });
});
