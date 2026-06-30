# CLAUDE.md — new-world-bot

Discord bot that auto-fetches Bible verses from jw.org when cited in Discord messages.

## Architecture

Event-driven Discord.js v14 bot. Stateless — no database, no persistent state.

```
index.ts                  # Bootstrap: Discord client, dynamic event loader
events/
  messageReceived.ts      # Core logic: parse citations → fetch from wol.jw.org → post embeds
data/
  books.ts                # 66 Bible books with names, abbreviations, chapter counts, jw.org keys
tsconfig.json             # NodeNext module resolution, ES2022 target
eslint.config.js          # ESLint 10 flat config with typescript-eslint
```

### Event loader pattern (`index.ts`)

Dynamically imports all `.ts` files from `events/`. Each event module exports:

```js
export default {
  name: Events.MessageCreate,  // discord.js event name
  once: false,                 // optional: register with client.once()
  async execute(client, ...args) { ... }
}
```

### External API

- **Endpoint**: `https://wol.jw.org/en/wol/l/r1/lp-e?q={queryString}`
- **Query format**: `book chapter:verse` strings joined by `; ` (e.g., `genesis 1:1; john 3:16`)
- **Multiple verses**: Single request with semicolon-separated queries
- **Response**: HTML page; parsed with jsdom
- **Headers**: `User-Agent` (Chrome) + `Accept` to avoid blocking

## Key Functions (`messageReceived.ts`)

| Function | Signature | Purpose |
|---|---|---|
| `execute` | `(client: Client, message: Message): void` | Entry: filter bots, check guild + permissions, run pipeline |
| `extractBibleVerses` | `(message: Message<true>): void` | Regex parse message content, build query strings, call `fetchAndSendVerses` |
| `buildQueryParts` | `(book: Book, chaptersAndVerses: string): string[]` | Parse verse range string into normalized `chapter:verse` parts |
| `fetchAndSendVerses` | `(message: Message<true>, queryString: string): Promise<void>` | Fetch from wol.jw.org, parse HTML, send embeds |
| `findBook` | `(bookName: string): Book \| undefined` | Case-insensitive match against book abbreviations |
| `createEmbed` | `(citation: string, verseText: string): EmbedBuilder` | Build Discord embed (color: `0x4A6DA7`) |

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

1. `fetch` gets HTML page from wol.jw.org
2. jsdom parses full HTML document
3. Footnote links + citation links (`a.fn`, `a.b`) removed
4. Verse number links (`a.vx.vp`) replaced with ` **{n}** `
5. Newlines collapsed, whitespace normalized
6. 4096-char limit enforced per embed description; title capped at 256

## Permissions

Bot checks `SendMessages` + `SendMessagesInThreads` before processing any message. Silent return if missing — no error logged.

## Development

### Run

```sh
npm start          # tsx index.ts (dotenv loaded via import 'dotenv/config' at top of index.ts)
```

Requires `.env` with:
```
DISCORD_TOKEN=your_bot_token_here
```

No compilation step. `tsx` executes TypeScript directly.

### Type check

```sh
npx tsc --noEmit
```

### Debug (VS Code)

Launch config in `.vscode/launch.json` — uses `tsx` runtime, auto-loads `.env`.

### Lint

```sh
npm run lint       # eslint . (ESLint 10 flat config via eslint.config.js)
```

Config: `typescript-eslint` recommended rules, Windows line endings (`\r\n`).

**No test framework installed.** `npm test` is a placeholder.

## Conventions

- TypeScript strict mode enabled; all code must pass `tsc --noEmit`
- ES modules (`"type": "module"` in package.json, `module: NodeNext` in tsconfig) — use `import`/`export`
- Import paths use `.js` extension even for `.ts` files (NodeNext resolution — tsx resolves at runtime)
- `Message<true>` used for guild-only message handlers; `message.inGuild()` type guard narrows at entry
- `async/await` throughout; no raw `.then()` chains
- Fetch errors caught silently in `fetchAndSendVerses` — bot never crashes on bad API response
- Chapterless book citations (e.g., Obadiah without chapter prefix) skipped when `chapterCount > 1`
- No rate limiting implemented — rely on browser header mimicry

## Dependencies

| Package | Use |
|---|---|
| `discord.js` ^14.16.1 | Discord API client |
| `jsdom` ^25.0.0 | HTML parsing of verse content |
| `dotenv` ^16.4.5 | Load `.env` into `process.env` |
| `typescript` ^6.0.3 | Type checker (dev) |
| `tsx` ^4.22.0 | Run TypeScript directly without compile step (dev + runtime) |
| `@types/node` ^25.8.0 | Node.js type definitions (dev) |
| `@types/jsdom` ^28.0.3 | jsdom type definitions (dev) |
| `typescript-eslint` ^8.59.3 | TypeScript ESLint rules (dev) |
| `eslint` ^10.3.0 | Linter (dev) |
