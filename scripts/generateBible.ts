/**
 * One-off generator for data/bible.json.
 *
 * Scrapes the full English NWT Study Edition (nwtsty) from wol.jw.org and stores
 * clean, per-verse text (no HTML, footnotes, or cross-references). Verse-number
 * markers are NOT stored — the bot renders them at serve time.
 *
 * Run:  npx tsx scripts/generateBible.ts
 *       (`extractChapter` is exported so an alternate fetcher can reuse it.)
 *
 * Output shape (data/bible.json), keyed by Book.bookIndex:
 *   { "1": [ [ "In the beginning...", ... ], ... ], ... }
 *   data[bookIndex][chapter - 1][verse - 1] = verse text
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import books from '../data/books.js';
import versification from '../data/versification.js';

const CONCURRENCY = 8;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * Extract clean text for every verse of one chapter from its reading-page HTML.
 * Each verse is one or more <span id="v{book}-{chapter}-{verse}-{seg}"> segments
 * (poetry splits a verse across segments); footnote/cross-ref anchors (a.fn,
 * a.b) and the verse-number anchor (a.vx.vp) are removed, segments are joined
 * with a space (so poetic lines never run together), and whitespace normalized.
 *
 * Returns an array indexed by verse-1 up to expectedVerses (the chapter's
 * highest verse number). The NWT omits some passages from the running text
 * (e.g. John 7:53-8:11), leaving gaps; those verses have no spans and are stored
 * as null so surrounding verses keep their correct index.
 */
export function extractChapter(html: string, bookIndex: number, chapter: number, expectedVerses: number): (string | null)[] {
  const { document } = new JSDOM(html).window;
  const verses: (string | null)[] = [];

  for (let verse = 1; verse <= expectedVerses; verse += 1) {
    const idRegex = new RegExp(`^v${bookIndex}-${chapter}-${verse}-\\d+$`);
    const spans = Array.from(document.querySelectorAll(`[id^="v${bookIndex}-${chapter}-${verse}-"]`))
      .filter((span) => idRegex.test(span.id));

    if (spans.length === 0) {
      verses.push(null); // omitted from the NWT running text
      continue;
    }

    const text = spans
      .map((span) => {
        const clone = span.cloneNode(true) as Element;
        Array.from(clone.querySelectorAll('a.fn, a.b')).forEach((el) => el.remove());
        Array.from(clone.querySelectorAll('a.vx.vp')).forEach((el) => el.remove());
        return clone.textContent ?? '';
      })
      .join(' ')
      .replaceAll('\n', ' ')
      .replaceAll(/\s{2,}/g, ' ')
      .trim();

    verses.push(text || null);
  }

  // The highest verse number came from an existing span, so it must be present;
  // if the last verse or the whole chapter is empty the page failed to load.
  if (verses.length === 0 || verses[verses.length - 1] === null || verses.every((v) => v === null)) {
    throw new Error(`chapter scrape incomplete: ${bookIndex}/${chapter}`);
  }

  return verses;
}

async function fetchChapter(bookIndex: number, chapter: number, expectedVerses: number): Promise<(string | null)[]> {
  const url = `https://wol.jw.org/en/wol/b/r1/lp-e/nwtsty/${bookIndex}/${chapter}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return extractChapter(await res.text(), bookIndex, chapter, expectedVerses);
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw new Error('unreachable');
}

export async function downloadBible(): Promise<void> {
  const tasks: { bookIndex: number; chapter: number; verses: number }[] = [];
  for (const book of books) {
    const counts = versification[book.bookIndex];
    for (let chapter = 1; chapter <= book.chapterCount; chapter += 1) {
      tasks.push({ bookIndex: book.bookIndex, chapter, verses: counts[chapter - 1] });
    }
  }

  const bible: Record<number, (string | null)[][]> = {};
  for (const book of books) bible[book.bookIndex] = new Array(book.chapterCount);

  let done = 0;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const task = tasks[next++];
      bible[task.bookIndex][task.chapter - 1] = await fetchChapter(task.bookIndex, task.chapter, task.verses);
      done += 1;
      if (done % 50 === 0 || done === tasks.length) console.log(`  ${done}/${tasks.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  await writeFile(new URL('../data/bible.json', import.meta.url), `${JSON.stringify(bible)}\n`);
  console.log('Wrote data/bible.json');
}

// Only scrape when executed directly, so `extractChapter` / `downloadBible`
// can be imported without side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  downloadBible().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
