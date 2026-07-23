import { Events, EmbedBuilder, PermissionFlagsBits, Client, Message } from 'discord.js';

import bible from '../data/bible.js';
import books, { type Book } from '../data/books.js';
import versification from '../data/versification.js';

export function findBook(bookName: string): Book | undefined {
  return books.find((book) => book.abbreviations.includes(bookName));
}

// Highest valid verse number in a given chapter of a book (NWT versification).
// Falls back to the longest chapter in the Bible if data is unavailable.
function versesInChapter(book: Book, chapter: number): number {
  return versification[book.bookIndex]?.[chapter - 1] ?? 176;
}

function createEmbed(citation: string, verseText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x4A6DA7)
    .setTitle(citation)
    .setDescription(verseText);
}

export function buildQueryParts(book: Book, chaptersAndVerses: string): string[] {
  const queryParts: string[] = [];
  let match: RegExpExecArray | null;
  let previousChapter = 1;

  const verseRegex = /(((?<ChapterStart>\d+):)?(?<VerseStart>\d+)-(?<ChapterEnd>\d+):(?<VerseEnd>\d+)|(?:(?<Chapter>\d+)+:)?(?:(?:(?<RangeStart>\d+)-(?<RangeEnd>\d+))|(?<Verse>\d+)))/gm;

  while ((match = verseRegex.exec(chaptersAndVerses)) !== null) {
    if (match.index === verseRegex.lastIndex) {
      verseRegex.lastIndex += 1;
    }

    const groups = match.groups as {
      ChapterStart?: string;
      VerseStart?: string;
      ChapterEnd?: string;
      VerseEnd?: string;
      Chapter?: string;
      RangeStart?: string;
      RangeEnd?: string;
      Verse?: string;
    };

    const { ChapterStart, VerseStart, ChapterEnd, VerseEnd, Chapter, RangeStart, RangeEnd, Verse } = groups;

    const chapterStart = parseInt(ChapterStart ?? Chapter ?? String(previousChapter), 10);
    const chapterEnd = parseInt(ChapterEnd ?? String(chapterStart), 10);
    const verseStart = parseInt(ChapterStart ? (VerseStart ?? '1') : (RangeStart ?? Verse ?? '1'), 10);
    const verseEnd = parseInt(ChapterStart ? (VerseEnd ?? String(verseStart)) : (RangeEnd ?? String(verseStart)), 10);

    if (queryParts.length === 0 && !(ChapterStart || Chapter) && book.chapterCount > 1) {
      return [];
    }

    previousChapter = Math.max(chapterStart, chapterEnd);

    if (chapterStart >= 1 && verseStart >= 1 && verseEnd >= 1
      && chapterStart <= chapterEnd
      && chapterEnd <= book.chapterCount
      && verseStart <= versesInChapter(book, chapterStart)
      && verseEnd <= versesInChapter(book, chapterEnd)
      && (verseStart <= verseEnd || chapterStart < chapterEnd)) {
      let part: string;
      if (chapterStart !== chapterEnd) {
        part = `${chapterStart}:${verseStart}-${chapterEnd}:${verseEnd}`;
      } else if (verseStart !== verseEnd) {
        part = `${chapterStart}:${verseStart}-${verseEnd}`;
      } else {
        part = `${chapterStart}:${verseStart}`;
      }
      queryParts.push(part);
    }
  }

  return queryParts;
}

const MAX_DESCRIPTION = 4096;
const MAX_TITLE = 256;

// Render the verse text for a single normalized part (from buildQueryParts):
// "c:v", "c:v1-v2", or "c1:v1-c2:v2". Each verse is prefixed with its number
// as ` **{n}** ` (matching the previous jw.org-sourced formatting). Returns
// undefined if the part is malformed or any verse is missing from the cache.
export function renderPart(book: Book, part: string): string | undefined {
  const match = /^(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/.exec(part);
  if (!match) {
    return undefined;
  }

  const chapterStart = parseInt(match[1], 10);
  const verseStart = parseInt(match[2], 10);
  const chapterEnd = match[3] ? parseInt(match[3], 10) : chapterStart;
  const verseEnd = match[4] ? parseInt(match[4], 10) : verseStart;

  const chapters = bible[book.bookIndex];
  if (!chapters) {
    return undefined;
  }

  const rendered: string[] = [];
  for (let chapter = chapterStart; chapter <= chapterEnd; chapter += 1) {
    const verses = chapters[chapter - 1];
    if (!verses) {
      return undefined;
    }
    const from = chapter === chapterStart ? verseStart : 1;
    const to = chapter === chapterEnd ? verseEnd : verses.length;
    for (let verse = from; verse <= to; verse += 1) {
      const text = verses[verse - 1];
      if (text === undefined) {
        return undefined;
      }
      if (text === null) {
        continue; // verse omitted from the NWT running text
      }
      rendered.push(`**${verse}** ${text}`);
    }
  }

  return rendered.length > 0 ? rendered.join(' ') : undefined;
}

// Render a full citation (book + raw "chaptersAndVerses") into a single embed's
// worth of title + description, combining all of its parts.
export function renderCitation(book: Book, chaptersAndVerses: string): { citation: string; text: string } | undefined {
  const chunks = buildQueryParts(book, chaptersAndVerses)
    .map((part) => renderPart(book, part))
    .filter((chunk): chunk is string => chunk !== undefined);

  if (chunks.length === 0) {
    return undefined;
  }

  let text = chunks.join(' ');
  if (text.length > MAX_DESCRIPTION) {
    text = `${text.slice(0, MAX_DESCRIPTION - 3)}...`;
  }

  return { citation: `${book.name} ${chaptersAndVerses}`.trim(), text };
}

async function sendEmbeds(message: Message<true>, embeds: EmbedBuilder[]): Promise<void> {
  for (const embed of embeds) {
    try {
      await message.channel.send({ embeds: [embed] });
    } catch (err) {
      console.error(err);
    }
  }
}

export const citationRegex = /(?<BookName>(?:[1-3]\s?)?[A-Za-z]+\.?)\s?(?<ChaptersAndVerses>(?:(?:(?:;\s?|,\s?|-)?\d+:)?\d+(?:(?:(?:,\s?|-(?!\d+:\d+))\d+(?!:))*))+)/gm;

// Scan a message for every citation whose book is known and whose verse range
// is valid, returning the matched book plus its raw "chaptersAndVerses" text.
export function parseBibleCitations(content: string): { book: Book; chaptersAndVerses: string }[] {
  let match: RegExpExecArray | null;
  const citations: { book: Book; chaptersAndVerses: string }[] = [];

  const regex = new RegExp(citationRegex.source, citationRegex.flags);

  while ((match = regex.exec(content)) !== null) {
    const { groups } = match;
    if (!groups) break;

    const bookName = groups['BookName'].replaceAll(/[.\s]/g, '').toLowerCase();
    const chaptersAndVerses = groups['ChaptersAndVerses'];

    const foundBook = findBook(bookName);

    if (foundBook) {
      if (buildQueryParts(foundBook, chaptersAndVerses).length > 0) {
        citations.push({ book: foundBook, chaptersAndVerses });
      }
      regex.lastIndex = match.index + match[0].length;
    } else if (groups['BookName']) {
      regex.lastIndex = match.index + groups['BookName'].length;
    } else {
      regex.lastIndex = match.index + 1;
    }
  }

  return citations;
}

export function parseBibleVerses(content: string): string[] {
  return parseBibleCitations(content)
    .map(({ book, chaptersAndVerses }) => `${book.name.toLowerCase()} ${chaptersAndVerses}`);
}

function extractBibleVerses(message: Message<true>): void {
  const embeds = parseBibleCitations(message.content)
    .map(({ book, chaptersAndVerses }) => renderCitation(book, chaptersAndVerses))
    .filter((rendered): rendered is { citation: string; text: string } =>
      rendered !== undefined && rendered.citation.length <= MAX_TITLE)
    .map(({ citation, text }) => createEmbed(citation, text));

  if (embeds.length > 0) {
    void sendEmbeds(message, embeds);
  }
}

export default {
  name: Events.MessageCreate,
  execute(client: Client, message: Message): void {
    if (message.author === client.user || message.author.bot) {
      return;
    }

    if (!message.inGuild()) {
      return;
    }

    if (!message.guild.members.me?.permissionsIn(message.channel)
      .has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.SendMessagesInThreads])) {
      return;
    }

    extractBibleVerses(message);
  },
};
