import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';

interface BotEvent {
  name: string;
  once?: boolean;
  execute: (client: Client, ...args: unknown[]) => void | Promise<void>;
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

eventFiles.forEach(async (file) => {
  const filePath = path.join(eventsPath, file);
  const event = (await import(`file://${filePath}`)).default as BotEvent;
  if (event.once) {
    client.once(event.name, (...args) => event.execute(client, ...args));
  } else {
    client.on(event.name, (...args) => event.execute(client, ...args));
  }
});

client.login(process.env['DISCORD_TOKEN']);
