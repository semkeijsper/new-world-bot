import { Events } from 'discord.js';
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

function lookupVerses(book, chaptersAndVerses) {
  let match;
  let currentChapter = 1;

  // eslint-disable-next-line no-cond-assign
  while ((match = verseRegex.exec(chaptersAndVerses)) !== null) {
    if (match.index === verseRegex.lastIndex) {
      verseRegex.lastIndex += 1;
    }

    const {
      ChapterStart, VerseStart, ChapterEnd, VerseEnd, Chapter, RangeStart, RangeEnd, Verse,
    } = match.groups;

    const chapterStart = parseInt(ChapterStart || Chapter || currentChapter, 10);
    const chapterEnd = parseInt(ChapterEnd || chapterStart, 10);
    const verseStart = parseInt(ChapterStart ? VerseStart : RangeStart || Verse, 10);
    const verseEnd = parseInt(ChapterStart ? VerseEnd : RangeEnd || verseStart, 10);
    currentChapter = Math.max(chapterStart, chapterEnd);

    if (currentChapter <= book.chapterCount
      && chapterStart <= chapterEnd && verseStart <= verseEnd) {
      let codeString = getJwApiCode(book.bookIndex, chapterStart, verseStart);

      if (chapterStart !== chapterEnd || verseStart !== verseEnd) {
        codeString += `-${getJwApiCode(book.bookIndex, chapterEnd, verseEnd)}`;
      }

      console.log(codeString);
    }
  }
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
      lookupVerses(foundBook, chaptersAndVerses);
      regex.lastIndex = match.index + match[0].length;
    } else if (groups.BookName) {
      regex.lastIndex = match.index + groups.BookName.length;
    } else {
      regex.lastIndex = match.index + 1;
    }
  }

  message.channel.send(JSON.stringify(foundBooks, null, 2));
}

export default {
  name: Events.MessageCreate,
  execute(client, message) {
    if (message.author === client.user) {
      return;
    }

    extractBibleVerses(message);
  },
};
