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
import { existsSync } from 'node:fs';
import { appendFile, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import books, { type Book } from '../data/books.js';
import versification from '../data/versification.js';

const CONCURRENCY = 8;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

const bibleUrl = new URL('../data/bible.json', import.meta.url);
const checkpointUrl = new URL('../data/.bible-cache.jsonl', import.meta.url);

// --- checkpoint helpers (pure, so they can be unit-tested without I/O) -------

const chapterKey = (bookIndex: number, chapter: number): string => `${bookIndex}:${chapter}`;

// One append-only JSONL record for a completed chapter.
export function serializeChapterLine(bookIndex: number, chapter: number, verses: (string | null)[]): string {
  return `${JSON.stringify({ b: bookIndex, c: chapter, v: verses })}\n`;
}

// Parse a checkpoint file into a map keyed by "book:chapter". Blank lines and a
// truncated final line (from a crash mid-write) are skipped rather than fatal.
export function parseCheckpoint(text: string): Map<string, (string | null)[]> {
  const done = new Map<string, (string | null)[]>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const { b, c, v } = JSON.parse(line) as { b: number; c: number; v: (string | null)[] };
      done.set(chapterKey(b, c), v);
    } catch {
      // truncated/partial line — ignore
    }
  }
  return done;
}

// Order the collected chapters into the final bible.json shape, keyed by
// bookIndex. Throws if any expected (book, chapter) is missing.
export function assembleBible(results: Map<string, (string | null)[]>, bookList: Book[]): Record<number, (string | null)[][]> {
  const bible: Record<number, (string | null)[][]> = {};
  for (const book of bookList) {
    const chapters: (string | null)[][] = [];
    for (let chapter = 1; chapter <= book.chapterCount; chapter += 1) {
      const verses = results.get(chapterKey(book.bookIndex, chapter));
      if (!verses) throw new Error(`missing chapter ${book.name} ${chapter}`);
      chapters.push(verses);
    }
    bible[book.bookIndex] = chapters;
  }
  return bible;
}

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
  const allTasks: { bookIndex: number; chapter: number; verses: number }[] = [];
  for (const book of books) {
    const counts = versification[book.bookIndex];
    for (let chapter = 1; chapter <= book.chapterCount; chapter += 1) {
      allTasks.push({ bookIndex: book.bookIndex, chapter, verses: counts[chapter - 1] });
    }
  }
  const total = allTasks.length;

  // Resume: load any chapters already completed on a previous run.
  const results = existsSync(checkpointUrl)
    ? parseCheckpoint(await readFile(checkpointUrl, 'utf8'))
    : new Map<string, (string | null)[]>();
  if (results.size > 0) {
    console.log(`resumed ${results.size}/${total} chapters from checkpoint`);
  }

  const tasks = allTasks.filter((task) => !results.has(chapterKey(task.bookIndex, task.chapter)));

  // Serialize checkpoint appends so concurrent workers never interleave a line.
  let appendChain: Promise<unknown> = Promise.resolve();
  const persist = (line: string): Promise<unknown> => {
    appendChain = appendChain.then(() => appendFile(checkpointUrl, line));
    return appendChain;
  };

  const failures: { bookIndex: number; chapter: number }[] = [];
  let done = results.size;
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const task = tasks[next++];
      try {
        const verses = await fetchChapter(task.bookIndex, task.chapter, task.verses);
        results.set(chapterKey(task.bookIndex, task.chapter), verses);
        await persist(serializeChapterLine(task.bookIndex, task.chapter, verses));
      } catch (err) {
        // A sustained failure (outage/block) is not fatal — record and continue;
        // the checkpoint keeps every success so a re-run resumes the rest.
        console.error(`failed ${task.bookIndex}/${task.chapter}:`, (err as Error).message);
        failures.push({ bookIndex: task.bookIndex, chapter: task.chapter });
        continue;
      }
      done += 1;
      if (done % 50 === 0 || done === total) console.log(`  ${done}/${total}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if (failures.length > 0) {
    console.error(`\n${failures.length} chapter(s) failed — re-run to resume (checkpoint kept at data/.bible-cache.jsonl).`);
    throw new Error(`${failures.length} chapters incomplete`);
  }

  // All chapters present: assemble, write atomically, then drop the checkpoint.
  const bible = assembleBible(results, books);
  const tmpUrl = new URL('../data/bible.json.tmp', import.meta.url);
  await writeFile(tmpUrl, `${JSON.stringify(bible)}\n`);
  await rename(tmpUrl, bibleUrl);
  await rm(checkpointUrl, { force: true });
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
