import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits } from 'discord.js';

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>`
// is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
  console.log(client.user);
});

// client.on(Events.MessageCreate, (message) => {
//   console.log(message);
//   if (message.author !== client.user) {
//     message.channel.send(`hey there, ${message.author.displayName}`);
//   }
// });

const eventsPath = path.join(import.meta.dirname, 'events');
const eventFiles = fs
  .readdirSync(eventsPath)
  .filter((file) => file.endsWith('.js'));

eventFiles.forEach(async (file) => {
  const filePath = path.join(eventsPath, file);
  const event = (await import(`file://${filePath}`)).default;
  if (event.once) {
    client.once(event.name, (...args) => event.execute(client, ...args));
  } else {
    client.on(event.name, (...args) => event.execute(client, ...args));
  }
});

// Log in to Discord with your client's token
client.login(process.env.DISCORD_TOKEN);
