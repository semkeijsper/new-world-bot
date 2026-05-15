# CLAUDE.md — new-world-bot

Discord bot that auto-fetches Bible verses from jw.org when cited in Discord messages.

## Architecture

Event-driven Discord.js v14 bot. Stateless — no database, no persistent state.

```
index.js                  # Bootstrap: Discord client, dynamic event loader
events/
  messageReceived.js      # Core logic: parse citations → fetch from jw.org → post embeds
data/
  books.js                # 66 Bible books with names, abbreviations, chapter counts, jw.org keys
```

### Event loader pattern (`index.js`)

Dynamically imports all `.js` files from `events/`. Each event module exports:

```js
export default {
  name: Events.MessageCreate,  // discord.js event name
  once: false,                 // optional: register with client.once()
  async execute(client, ...args) { ... }
}
```

### External API

- **Endpoint**: `https://www.jw.org/en/library/bible/study-bible/books/json/html/{codes}`
- **Code format**: 9-digit string — `{bookIndex:02d}{chapter:03d}{verse:03d}` (e.g., `010001001` = Genesis 1:1)
- **Multiple verses**: Comma-separated codes in one request
- **Response**: JSON with HTML verse content; parsed with jsdom
- **Headers**: Mimics Chrome browser (User-Agent, Cookie, Referer) to avoid blocking

## Key Functions (`messageReceived.js`)

| Function | Purpose |
|---|---|
| `execute(client, message)` | Entry: filter bots, check permissions, run pipeline |
| `extractBibleVerses(message)` | Regex parse message content → array of `{book, chapter, verse, endVerse, endChapter}` |
| `lookupVerses(citations)` | Batch fetch from jw.org API, parse HTML, return verse texts |
| `findBook(bookName)` | Case-insensitive match against book names and all abbreviations |
| `getJwApiCode(bookIndex, chapter, verse)` | Convert citation to 9-digit API code |
| `createEmbed(citation, verseText)` | Build Discord embed (color: `#006fb9`) |

## Citation Parsing

Handles multiple formats in a single message:
- `Gen 1:1` — single verse
- `Gen 1:1-5` — verse range
- `Gen 1:1-2:5` — cross-chapter range
- `Gen 1:1, 3-5` — multiple with shared chapter context
- `1 John 2:1` — numbered book names
- Shorthand continuations (chapter remembered within same parse)

Books matched against full names + all abbreviations in `books.js`. Case-insensitive.

## Verse Text Processing

1. Axios fetches JSON from jw.org
2. jsdom parses HTML fragment
3. Citation spans stripped (`.b` class)
4. Footnote markers stripped
5. Non-breaking spaces (` `) → regular spaces
6. Verse numbers formatted as `**{n}**`
7. Discord 2000-char limit enforced per embed

## Permissions

Bot checks `SendMessages` + `SendMessagesInThreads` before processing any message. Silent return if missing — no error logged.

## Development

### Run

```sh
npm start          # node -r dotenv/config index.js
```

Requires `.env` with:
```
DISCORD_TOKEN=your_bot_token_here
```

### Debug (VS Code)

Launch config in `.vscode/launch.json` — auto-loads `.env`.

### Lint

```sh
npx eslint .
```

Config: Airbnb base style, ECMAScript 2024, Windows line endings (`\r\n`).

**No test framework installed.** `npm test` is a placeholder.

## Conventions

- ES modules (`"type": "module"` in package.json) — use `import`/`export`, not `require`
- `async/await` throughout; no raw `.then()` chains
- Axios errors caught silently in `lookupVerses` — bot never crashes on bad API response
- Chapterless book citations (e.g., Obadiah without chapter prefix) skipped when `chapterCount > 1`
- No rate limiting implemented — rely on browser header mimicry

## Dependencies

| Package | Use |
|---|---|
| `discord.js` ^14.16.1 | Discord API client |
| `axios` ^1.7.7 | HTTP requests to jw.org |
| `jsdom` ^25.0.0 | HTML parsing of verse content |
| `dotenv` ^16.4.5 | Load `.env` into `process.env` |
