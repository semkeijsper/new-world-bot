import { Events, EmbedBuilder, PermissionFlagsBits, Client, Message } from 'discord.js';
import { JSDOM } from 'jsdom';

import books, { type Book } from '../data/books.js';

function findBook(bookName: string): Book | undefined {
  return books.find((book) => book.abbreviations.includes(bookName));
}

function createEmbed(citation: string, verseText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x4A6DA7)
    .setTitle(citation)
    .setDescription(verseText);
}

async function lookupVerses(message: Message<true>, book: Book, chaptersAndVerses: string): Promise<void> {
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
      return;
    }

    previousChapter = Math.max(chapterStart, chapterEnd);

    if (previousChapter <= book.chapterCount && verseStart <= 176
      && chapterStart <= chapterEnd
      && (verseStart <= verseEnd || (verseStart > verseEnd && chapterStart < chapterEnd))) {
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

  if (queryParts.length === 0) {
    return;
  }

  const queryString = `${book.name.toLowerCase()} ${queryParts.join('; ')}`;
  const url = `https://wol.jw.org/en/wol/l/r1/lp-e?${new URLSearchParams({ q: queryString }).toString()}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  let html: string;
  try {
    console.log(`Looking up ${book.name} ${chaptersAndVerses} for ${message.author.displayName}...`);
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

    const messageToSend = `${citation}\n${verseText}`;
    if (messageToSend.length <= 2000) {
      const embed = createEmbed(citation, verseText);
      try {
        await message.channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(err);
      }
    }
  }
}

function extractBibleVerses(message: Message<true>): void {
  let match: RegExpExecArray | null;

  const regex = /(?<BookName>(?:[1-3]\s?)?[A-Za-z]+\.?)\s?(?<ChaptersAndVerses>(?:(?:(?:;\s?|-)?\d+:)?\d+(?:(?:(?:,\s?|-(?!\d+:\d+))\d+)*))+)/gm;

  while ((match = regex.exec(message.content)) !== null) {
    const { groups } = match;
    if (!groups) break;

    const bookName = groups['BookName'].replaceAll(/[.\s]/g, '').toLowerCase();
    const chaptersAndVerses = groups['ChaptersAndVerses'];

    const foundBook = findBook(bookName);

    if (foundBook) {
      lookupVerses(message, foundBook, chaptersAndVerses);
      regex.lastIndex = match.index + match[0].length;
    } else if (groups['BookName']) {
      regex.lastIndex = match.index + groups['BookName'].length;
    } else {
      regex.lastIndex = match.index + 1;
    }
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
