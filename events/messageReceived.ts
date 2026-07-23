import { Events, EmbedBuilder, PermissionFlagsBits, Client, Message } from 'discord.js';
import { JSDOM } from 'jsdom';

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

async function fetchAndSendVerses(message: Message<true>, queryString: string): Promise<void> {
  const url = `https://wol.jw.org/en/wol/l/r1/lp-e?${new URLSearchParams({ q: queryString }).toString()}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let html: string;
  try {
    console.log(`Looking up "${queryString}" for ${message.author.displayName}...`);
    await message.channel.sendTyping();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return;
    }
    html = await response.text();
  } catch (err) {
    console.error(err);
    return;
  }

  const dom = new JSDOM(html);
  const document = dom.window.document;
  const resultGroups = document.querySelectorAll('ul.results');

  if (resultGroups.length === 0) {
    console.log(`No results from wol.jw.org for: ${queryString}`);
    return;
  }

  for (const group of resultGroups) {
    const citation = group.querySelector('.cardLine1.cardLine1Prominent')?.textContent?.trim() ?? '';

    const article = group.querySelector('article.scalableui');
    if (!article) continue;

    Array.from(article.querySelectorAll('a.fn, a.b')).forEach((el) => el.remove());

    Array.from(article.querySelectorAll('a.vx.vp')).forEach((el) => {
      const num = el.textContent?.trim() ?? '';
      el.replaceWith(` **${num}** `);
    });

    const verseText = article.textContent
      ?.replaceAll('\n', ' ')
      .replaceAll(/\s{2,}/g, ' ')
      .trim() ?? '';

    if (!citation || !verseText) continue;

    if (citation.length <= 256) {
      const truncated = verseText.length > 4096 ? `${verseText.slice(0, 4093)}...` : verseText;
      const embed = createEmbed(citation, truncated);
      try {
        await message.channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(err);
      }
    }
  }
}

export const citationRegex = /(?<BookName>(?:[1-3]\s?)?[A-Za-z]+\.?)\s?(?<ChaptersAndVerses>(?:(?:(?:;\s?|,\s?|-)?\d+:)?\d+(?:(?:(?:,\s?|-(?!\d+:\d+))\d+(?!:))*))+)/gm;

export function parseBibleVerses(content: string): string[] {
  let match: RegExpExecArray | null;
  const bookQueries: string[] = [];

  const regex = new RegExp(citationRegex.source, citationRegex.flags);

  while ((match = regex.exec(content)) !== null) {
    const { groups } = match;
    if (!groups) break;

    const bookName = groups['BookName'].replaceAll(/[.\s]/g, '').toLowerCase();
    const chaptersAndVerses = groups['ChaptersAndVerses'];

    const foundBook = findBook(bookName);

    if (foundBook) {
      if (buildQueryParts(foundBook, chaptersAndVerses).length > 0) {
        bookQueries.push(`${foundBook.name.toLowerCase()} ${chaptersAndVerses}`);
      }
      regex.lastIndex = match.index + match[0].length;
    } else if (groups['BookName']) {
      regex.lastIndex = match.index + groups['BookName'].length;
    } else {
      regex.lastIndex = match.index + 1;
    }
  }

  return bookQueries;
}

function extractBibleVerses(message: Message<true>): void {
  const bookQueries = parseBibleVerses(message.content);

  if (bookQueries.length > 0) {
    fetchAndSendVerses(message, bookQueries.join('; '));
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
