import { Events, EmbedBuilder, PermissionFlagsBits, Client, Message } from 'discord.js';
import axios from 'axios';
import { JSDOM } from 'jsdom';

import books, { type Book } from '../data/books.js';

axios.defaults.withCredentials = true;

interface JwRange {
  citation: string;
  html: string;
}

interface JwApiResponse {
  ranges: Record<string, JwRange> | null | undefined;
}

function findBook(bookName: string): Book | undefined {
  return books.find((book) => book.abbreviations.includes(bookName));
}

function getJwApiCode(bookIndex: number, chapter: number, verse: number): string {
  return bookIndex.toString().padStart(2, '0') + chapter.toString().padStart(3, '0') + verse.toString().padStart(3, '0');
}

function createEmbed(citation: string, verseText: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x4A6DA7)
    .setTitle(citation)
    .setDescription(verseText);
}

async function lookupVerses(message: Message<true>, book: Book, chaptersAndVerses: string): Promise<void> {
  const allCodes: string[] = [];
  let match: RegExpExecArray | null;
  let previousChapter = 1;
  let previousVerse = 1;

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

    if (allCodes.length === 0 && !(ChapterStart || Chapter) && book.chapterCount > 1) {
      return;
    }

    previousChapter = Math.max(chapterStart, chapterEnd);

    if (previousChapter <= book.chapterCount && verseStart <= 176
      && chapterStart <= chapterEnd
      && (verseStart <= verseEnd || (verseStart > verseEnd && chapterStart < chapterEnd))) {
      let codeString = getJwApiCode(book.bookIndex, chapterStart, verseStart);

      if (chapterStart !== chapterEnd || verseStart !== verseEnd) {
        codeString += `-${getJwApiCode(book.bookIndex, chapterEnd, verseEnd)}`;
        allCodes.push(codeString);
      } else if (allCodes.length > 0 && verseStart - 1 === previousVerse) {
        const index = allCodes.length - 1;
        allCodes[index] = `${allCodes[index].substring(0, 8)}-${codeString}`;
      } else {
        allCodes.push(codeString);
      }

      previousVerse = Math.max(verseStart, verseEnd);
    }
  }

  if (allCodes.length === 0) {
    return;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'en-NL,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,nl;q=0.6',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    priority: 'u=1, i',
    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'XMLHttpRequest',
    cookie: 'cookieConsent-STRICTLY_NECESSARY=true; cookieConsent-FUNCTIONAL=true; cookieConsent-DIAGNOSTIC=true; cookieConsent-USAGE=true; akacd_rel=1740247020~rv=43~id=c724ee26301e4c9242edd2a90efd3d87; ak_bmsc=50166DFB86CC0C0415AE7CDBCD0FF69B~000000000000000000000000000000~YAAQngcQAnsfUxOVAQAAykOXLhqYgLCPzvMjYn2Z830PcQOpwDcCPafUTX88sGp7F0EoYrk6EGOk/hkM4aBOywtbX+UDfGi1JNc+bGO5UsNOvl+qbvBMaieeoSl/3vnjrauI4+yj1d73IV8xxJwRB8LxS0/0Vr2C4sVNaaan1/AobJq/yN8bC4eTlZGxHPhPllAHznxSTYLopEUQqrvuRAullGczI2jlRc0/hqOvYUh+l7TB4xlu3NPerrv4VBt13GKmJj1SCKn17wvBWvHdvcLhqC+MF2EFQCoD0bZr8iZFUcyyokQ7LD9TbLdSrqVPCBw3dWi4/u98cut1FMDHOmhuOHXyW3e2zELpXPz9oMpCim1a6awQV1teCIi/zJ/fLgBPAuzs; ckLang=E; bm_sv=73A97B2209BC20D88D3942029A3E4EF6~YAAQMzAQYG5As9aUAQAAXfWwLhrsffIaHUZAsBeeb/c76KSR9tu/m+M0vL+/la+QCrPjxM1lCIUgzHldyrmbKoueOG1nNhnwONmthinP5HRoDJefc5MdxgKxQk3KTdj1d00rKf//lmAl/CyB6jgbryAmDsQTqxUuT4p6Ul9mFShZ7KO4KK0uf7nTt4/SKliJuNHxKjRpk7OhqJ/HMoxSTsxWNr97yc0E82vf/ALjyXFW5WLNN/VqJvGGjwdH~1',
    Referer: 'https://www.jw.org/en/library/series/more-topics/is-truth-important/',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };

  let response;
  try {
    console.log(`Looking up ${book.name} ${chaptersAndVerses} for ${message.author.displayName}...`);
    await message.channel.sendTyping();
    response = await axios.get<JwApiResponse>(`https://www.jw.org/en/library/bible/study-bible/books/json/html/${allCodes.join(',')}`, { headers });
  } catch (err) {
    console.error(err);
    return;
  }

  if (response.status !== 200) {
    return;
  }

  const { ranges } = response.data;

  if (ranges == null) {
    console.log(response);
    return;
  }

  Object.values(ranges).forEach(async (range) => {
    const citation = range.citation
      .replaceAll('&nbsp;', '\xa0')
      .replaceAll('–', '-');

    const html = range.html
      .replaceAll('<span class="newblock"></span>', ' ')
      .replaceAll(/<sup class="superscription">([\s\S]*?)<\/sup>/gm, ' _$1_')
      .replaceAll(/<span class="chapterNum">([\s\S]*?)<\/span>/gm, '1 ');

    const verseText = JSDOM.fragment(html).textContent
      ?.replaceAll(/[+*]/g, '')
      .replaceAll(/(?:\n+\s?)?(\d+)\s\s/g, ' <**$1**> ')
      .replaceAll('\n', '').trim() ?? '';

    const messageToSend = `${citation}\n${verseText}`;
    if (messageToSend.length <= 2000) {
      const embed = createEmbed(citation, verseText);
      try {
        await message.channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(err);
      }
    }
  });
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
