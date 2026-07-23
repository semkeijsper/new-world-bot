import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Client, Events, GatewayIntentBits } from 'discord.js';

interface BotEvent {
  name: string;
  once?: boolean;
  execute: (client: Client, ...args: unknown[]) => void | Promise<void>;
}

const biblePath = path.join(import.meta.dirname, 'data', 'bible.json');

// The NWT verse text is copyrighted and not shipped with the repo. On a fresh
// checkout data/bible.json is absent, so the bot cannot serve verses until it
// is downloaded from wol.jw.org. Tell the user and offer to download it now.
async function ensureBibleData(): Promise<boolean> {
  if (fs.existsSync(biblePath)) {
    return true;
  }

  console.log('\nThe New World Translation text (data/bible.json) was not found.');
  console.log('It is downloaded from wol.jw.org and is required before the bot can serve verses.');

  if (!process.stdin.isTTY) {
    console.log('Run `npm run scrape:bible` to download it, then start the bot again.\n');
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Download it now? This takes ~20-30 minutes. [Y/n] ')).trim().toLowerCase();
  rl.close();

  if (answer !== '' && answer !== 'y' && answer !== 'yes') {
    console.log('Run `npm run scrape:bible` when you are ready.\n');
    return false;
  }

  const { downloadBible } = await import('./scripts/generateBible.js');
  await downloadBible();
  return true;
}

async function main(): Promise<void> {
  if (!(await ensureBibleData())) {
    process.exit(1);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    console.log(client.user);
  });

  const eventsPath = path.join(import.meta.dirname, 'events');
  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith('.ts'));

  await Promise.all(eventFiles.map(async (file) => {
    const filePath = path.join(eventsPath, file);
    const event = (await import(`file://${filePath}`)).default as BotEvent;
    if (event.once) {
      client.once(event.name, (...args) => event.execute(client, ...args));
    } else {
      client.on(event.name, (...args) => event.execute(client, ...args));
    }
  }));

  await client.login(process.env['DISCORD_TOKEN']);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
