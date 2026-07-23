# CLAUDE.md — new-world-bot

Discord bot that auto-posts Bible verses (New World Translation) when they are cited in Discord messages. Verses are served from a **local, in-memory copy** of the NWT — the bot makes no network calls to jw.org at message time.

## Architecture

Event-driven Discord.js v14 bot. No database and no persistent runtime state; the only local data is a generated verse cache read once at startup.

```
index.ts                  # Bootstrap: ensure verse data, Discord client, dynamic event loader
events/
  messageReceived.ts      # Core logic: parse citations → render from local cache → post embeds
data/
  books.ts                # 66 Bible books: names, abbreviations, chapter counts, jw.org keys
  versification.ts        # NWT verses-per-chapter table (committed) — used for range bounds
  bible.ts                # Loader: JSON.parse(bible.json) → in-memory verse text; `bibleAvailable`
  bible.json              # Full NWT verse text (GITIGNORED — copyright; generated locally)
scripts/
  generateVersification.ts # One-off scraper → data/versification.ts
  generateBible.ts         # Resumable scraper → data/bible.json (also exported: downloadBible)
tests/
  parsing.test.ts         # Citation regex / findBook / buildQueryParts
  render.test.ts          # renderPart/renderCitation + bible.json integrity (skips if absent)
  checkpoint.test.ts      # Scraper checkpoint helpers
tsconfig.json             # NodeNext module resolution, ES2022 target
eslint.config.js          # ESLint 10 flat config with typescript-eslint
```

### Event loader pattern (`index.ts`)

`main()` first calls `ensureBibleData()` (see Verse Data below), then dynamically imports all `.ts` files from `events/`. Each event module exports:

```js
export default {
  name: Events.MessageCreate,  // discord.js event name
  once: false,                 // optional: register with client.once()
  async execute(client, ...args) { ... }
}
```

## Verse Data (local NWT cache)

The verse text is copyrighted, so **`data/bible.json` is gitignored and never committed** — each deployment generates it locally.

- **Shape**: `Record<number, (string | null)[][]>` keyed by `Book.bookIndex`; `bible[bookIndex][chapter-1][verse-1]` = clean verse text. `null` = a verse the NWT omits from the running text (e.g. John 7:53–8:11), so surrounding verses keep their index.
- **Loader** (`data/bible.ts`): reads the file once at startup, tolerates its absence (exports `{}` + `bibleAvailable = false`).
- **Startup** (`index.ts` `ensureBibleData`): if `bible.json` is missing, the bot explains it is required and offers to download it — interactive prompt on a TTY (runs `downloadBible()`), otherwise prints `npm run scrape:bible` and exits.
- **Versification** (`data/versification.ts`, committed): verses-per-chapter for all 66 books, used only for citation range validation — never for text.

## Key Functions (`messageReceived.ts`)

| Function | Signature | Purpose |
|---|---|---|
| `execute` | `(client, message): void` | Entry: filter bots, check guild + permissions, run pipeline |
| `extractBibleVerses` | `(message: Message<true>): void` | Render each parsed citation from the cache, send embeds |
| `parseBibleCitations` | `(content: string): { book: Book; chaptersAndVerses: string }[]` | Regex-scan message for valid, known-book citations |
| `parseBibleVerses` | `(content: string): string[]` | Thin wrapper over `parseBibleCitations` (used by tests) |
| `buildQueryParts` | `(book: Book, chaptersAndVerses: string): string[]` | Parse range string → normalized `chapter:verse` parts, bounds-validated |
| `versesInChapter` | `(book: Book, chapter: number): number` | Max valid verse for a chapter (from versification) |
| `renderPart` | `(book: Book, part: string): string \| undefined` | Verse text for one part, `**n**` markers, skips omitted verses |
| `renderCitation` | `(book, chaptersAndVerses): { citation; text } \| undefined` | Combine a citation's parts into one embed body (4096-char cap) |
| `findBook` | `(bookName: string): Book \| undefined` | Match against book abbreviations (caller lowercases) |
| `createEmbed` | `(citation, verseText): EmbedBuilder` | Build Discord embed (color `0x4A6DA7`, title capped at 256) |
| `citationRegex` | exported `RegExp` | Global/multiline citation matcher |

## Citation Parsing

Handles multiple formats in a single message:
- `Gen 1:1` — single verse
- `Gen 1:1-5` — verse range
- `Gen 1:1-2:5` — cross-chapter range
- `Gen 1:1, 3-5` — shared-chapter verse list
- `Gen 1:1-3, 2:4-6` — comma-separated chapter groups
- `1 John 2:1` — numbered book names
- Multiple citations separated by `;`, `and`, punctuation, or newlines

Books matched against full names + all abbreviations in `books.ts` (case-insensitive). Ranges validated in `buildQueryParts`: chapter/verse must be ≥ 1, within `chapterCount`, and within the chapter's NWT verse count (`versification.ts`); descending ranges rejected.

**Known limitation** (documented + tested): a cross-book comma like `1 John 1:1, 2 John 1` is ambiguous with a same-chapter verse list (`Gen 1:1, 3 and …`), so the trailing book is swallowed as a bare verse — use `;` to separate such citations.

## Verse Text Processing

Text is extracted **once at scrape time** (`scripts/generateBible.ts` `extractChapter`), not at message time:

1. Fetch the chapter reading page from wol.jw.org (`.../nwtsty/{bookIndex}/{chapter}`).
2. jsdom parses the page; each verse is one or more `<span id="v{b}-{c}-{v}-{seg}">` segments.
3. Footnote + cross-reference anchors (`a.fn`, `a.b`) removed; verse-number anchor (`a.vx.vp`) removed.
4. Segments joined with a **space** (poetic lines never run together, e.g. `way, Who`), whitespace normalized.
5. Absent verses (omitted passages) stored as `null`.

At message time, `renderPart` prefixes each verse with ` **{n}** ` and joins; `renderCitation` enforces the 4096-char description cap.

## Scraping (`scripts/*.ts`)

Both scrapers mimic a browser (`User-Agent` + `Accept`) and use a concurrency pool with 4× exponential-backoff retries.

- `generateVersification.ts` → `data/versification.ts` (committed).
- `generateBible.ts` → `data/bible.json`. **Crash-safe and resumable**: each finished chapter is appended to a JSONL checkpoint (`data/.bible-cache.jsonl`, gitignored); a re-run skips completed chapters and retries only failures; the final file is written atomically (temp + `rename`) and the checkpoint deleted. A sustained chapter failure is recorded (non-fatal) and the run exits non-zero with a resume message. `extractChapter`, `serializeChapterLine`, `parseCheckpoint`, `assembleBible`, and `downloadBible` are exported (unit-tested / reused by the startup offer).

## Permissions

Bot checks `SendMessages` + `SendMessagesInThreads` before processing any message. Silent return if missing.

## Development

### Run

```sh
npm start          # tsx index.ts (dotenv loaded via import 'dotenv/config')
```

Requires `.env` with `DISCORD_TOKEN=...`. On first run, if `data/bible.json` is missing the bot offers to download it (or run `npm run scrape:bible` beforehand). No compilation step — `tsx` executes TypeScript directly.

### Download / regenerate verse data

```sh
npm run scrape:bible          # download NWT text → data/bible.json (resumable)
npm run scrape:versification  # regenerate data/versification.ts
```

### Type check / lint / test

```sh
npx tsc --noEmit   # strict mode, all code must pass
npm run lint       # eslint . (flat config; Windows line endings \r\n)
npm test           # tsx --test tests/*.test.ts (node:test runner)
```

`npm test` runs the full suite. Render/integrity suites in `render.test.ts` **skip** when `data/bible.json` is absent and validate it when present.

### Debug (VS Code)

Launch config in `.vscode/launch.json` — `tsx` runtime, auto-loads `.env`.

## Conventions

- TypeScript strict mode; all code must pass `tsc --noEmit`.
- ES modules (`"type": "module"`, `module: NodeNext`) — use `import`/`export`; import paths use `.js` extension even for `.ts` files.
- Windows line endings (`\r\n`) enforced by ESLint on `.ts` files. `.json` files stay LF.
- `Message<true>` for guild-only handlers; `message.inGuild()` narrows at entry.
- `async/await` throughout; no raw `.then()` chains (except the scraper's internal append chain).
- Send errors caught silently — the bot never crashes on a bad send.
- Chapterless citations skipped when `chapterCount > 1`; allowed (as a bare verse) for single-chapter books.
- Scrapers must be re-runnable idempotently; never commit `data/bible.json`.

## Dependencies

| Package | Use |
|---|---|
| `discord.js` ^14.26.4 | Discord API client |
| `dotenv` ^17.4.2 | Load `.env` into `process.env` |
| `jsdom` ^29.1.1 | HTML parsing — used by the scrapers / startup download flow |
| `typescript` ^6.0.3 | Type checker (dev) |
| `tsx` ^4.22.4 | Run TypeScript directly + node:test runner (dev + runtime) |
| `@types/node` ^24 | Node.js type definitions (dev) |
| `@types/jsdom` ^28.0.3 | jsdom type definitions (dev) |
| `typescript-eslint` ^8.62.1 | TypeScript ESLint rules (dev) |
| `eslint` ^10.6.0 | Linter (dev) |
