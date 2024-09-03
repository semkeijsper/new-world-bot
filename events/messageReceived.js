import { Events } from 'discord.js';

const regex = /(?<BookName>(?:(?<=\s)[1-3]\s?)?[A-Za-z]+\.?)\s?(?<ChaptersAndVerses>(?:(?:(?:;\s?)?\d+:)?\d+(?:(?:(?:,\s?|-)\d+)*))+)/gm;

function extractBibleVerses(message) {
  let match;

  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(message.content)) !== null) {
    // This is necessary to avoid infinite loops with zero-width matches
    // if (match.index === regex.lastIndex) {
    //   regex.lastIndex += 1;
    // }

    const { groups } = match;

    if (groups.BookName) {
      regex.lastIndex = match.index + groups.BookName.length;
    } else {
      regex.lastIndex = match.index + 1;
    }
    // const bookName = groups.BookName;
    // const chapterAndVerses = groups.ChapterAndVerses;

    message.channel.send(JSON.stringify(groups));
  }
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
