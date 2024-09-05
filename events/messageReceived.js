/* eslint-disable import/no-extraneous-dependencies */
import { Events, EmbedBuilder } from 'discord.js';
import axios from 'axios';
import { JSDOM } from 'jsdom';

// eslint-disable-next-line import/extensions
import books from '../data/books.js';

const regex = /(?<BookName>(?:[1-3]\s?)?[A-Za-z]+\.?)\s?(?<ChaptersAndVerses>(?:(?:(?:;\s?|-)?\d+:)?\d+(?:(?:(?:,\s?|-(?!\d+:\d+))\d+)*))+)/gm;
const verseRegex = /(((?<ChapterStart>\d+):)?(?<VerseStart>\d+)-(?<ChapterEnd>\d+):(?<VerseEnd>\d+)|(?:(?<Chapter>\d+)+:)?(?:(?:(?<RangeStart>\d+)-(?<RangeEnd>\d+))|(?<Verse>\d+)))/gm;

function findBook(bookName) {
  return books.filter((book) => book.abbreviations.includes(bookName))[0];
}

function getJwApiCode(bookIndex, chapter, verse) {
  return bookIndex.toString().padStart(2, '0') + chapter.toString().padStart(3, '0') + verse.toString().padStart(3, '0');
}

function createEmbed(citation, verseText) {
  return new EmbedBuilder()
    .setColor(0x4A6DA7) // jw.org blue
    .setTitle(citation)
    .setDescription(verseText);
}

async function lookupVerses(message, book, chaptersAndVerses) {
  const allCodes = [];
  let match;
  let previousChapter = 1;
  let previousVerse = 1;

  // eslint-disable-next-line no-cond-assign
  while ((match = verseRegex.exec(chaptersAndVerses)) !== null) {
    if (match.index === verseRegex.lastIndex) {
      verseRegex.lastIndex += 1;
    }

    const {
      ChapterStart, VerseStart, ChapterEnd, VerseEnd, Chapter, RangeStart, RangeEnd, Verse,
    } = match.groups;

    const chapterStart = parseInt(ChapterStart || Chapter || previousChapter, 10);
    const chapterEnd = parseInt(ChapterEnd || chapterStart, 10);
    const verseStart = parseInt(ChapterStart ? VerseStart : RangeStart || Verse, 10);
    const verseEnd = parseInt(ChapterStart ? VerseEnd : RangeEnd || verseStart, 10);
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
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  };

  let response;
  try {
    console.log(`Looking up ${book.name} ${chaptersAndVerses} for ${message.author.displayName}...`);
    response = await axios.get(`https://www.jw.org/en/library/bible/study-bible/books/json/html/${allCodes.join(',')}`, { headers });
  } catch (err) {
    console.error(err);
    return;
  }

  if (response.status !== 200) {
    return;
  }

  const { ranges } = response.data;

  Object.values(ranges).forEach((range) => {
    // add non-breaking space and use normal hyphen to the citation
    const citation = range.citation
      .replaceAll('&nbsp;', '\xa0')
      .replaceAll('–', '-');

    // clean up the HTML pre-formatting
    const html = range.html
      .replaceAll('<span class="newblock"></span>', ' ')
      .replaceAll(/<sup class="superscription">([\s\S]*?)<\/sup>/gm, ' _$1_')
      .replaceAll(/<span class="chapterNum">([\s\S]*?)<\/span>/gm, '1 ');

    // parse the HTML, remove citations and footnote characters, format verse numbers
    const verseText = JSDOM.fragment(html).textContent
      .replaceAll(/[+*]/g, '')
      .replaceAll(/(?:\n+\s?)?(\d+)\s\s/g, ' <**$1**> ')
      .replaceAll('\n', '').trim();

    const messageToSend = `${citation}\n${verseText}`;
    if (messageToSend.length <= 2000) {
      const embed = createEmbed(citation, verseText);
      try {
        message.channel.send({ embeds: [embed] });
      } catch (err) {
        console.error(err);
      }
    }
  });
}

function extractBibleVerses(message) {
  let match;
  const foundBooks = [];

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(message.content)) !== null) {
    const { groups } = match;

    const bookName = groups.BookName.replaceAll(/[.\s]/g, '').toLowerCase();
    const chaptersAndVerses = groups.ChaptersAndVerses;

    const foundBook = findBook(bookName);

    if (foundBook) {
      foundBooks.push(`${foundBook.name} ${chaptersAndVerses}`);
      lookupVerses(message, foundBook, chaptersAndVerses);
      regex.lastIndex = match.index + match[0].length;
    } else if (groups.BookName) {
      regex.lastIndex = match.index + groups.BookName.length;
    } else {
      regex.lastIndex = match.index + 1;
    }
  }
}

export default {
  name: Events.MessageCreate,
  execute(client, message) {
    if (message.author === client.user || message.author.bot) {
      return;
    }

    extractBibleVerses(message);
  },
};
