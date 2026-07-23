import { existsSync, readFileSync } from 'node:fs';

// Full NWT verse text, downloaded locally by scripts/generateBible.ts.
// The text is copyrighted and is NOT committed — data/bible.json is gitignored,
// so it may be absent (e.g. a fresh clone). Load defensively in that case;
// index.ts checks `bibleAvailable` at startup and offers to download it.
// Keyed by Book.bookIndex; bible[bookIndex][chapter - 1][verse - 1] = text.
const biblePath = new URL('./bible.json', import.meta.url);

export const bibleAvailable = existsSync(biblePath);

// Verses omitted from the NWT running text (e.g. John 7:53-8:11) are stored as
// null so surrounding verses keep their verse-1 index.
const bible: Record<number, (string | null)[][]> = bibleAvailable
  ? (JSON.parse(readFileSync(biblePath, 'utf8')) as Record<number, (string | null)[][]>)
  : {};

export default bible;
