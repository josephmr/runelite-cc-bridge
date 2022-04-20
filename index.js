const WebSocket = require('ws');
const Database = require('@replit/database');
const Mutex = require('async-mutex').Mutex;
const express = require('express');
const {
  InteractionType,
  InteractionResponseType,
} = require('discord-interactions');
const {
  VerifyDiscordRequest,
  DiscordRequest,
} = require('./utils.js');
const {
  SUBSCRIBE_COMMAND,
  HasGuildCommands,
} = require('./commands.js');
const http = require('http');
const mutex = new Mutex();
const rdb = new Database();

const db = {
  async subscribe(cc, channelId) {
    return await mutex.runExclusive(
      async () => {
        let subscriptions = await rdb.get('subscriptions');
        if (subscriptions === null) {
          subscriptions = {};
        }
        subscriptions[cc] = {
          ...(subscriptions[cc] || {}),
          [channelId]: true
        };
        return await rdb.set('subscriptions', subscriptions);
      }
    )
  },

  async getChannels(cc) {
    return await mutex.runExclusive(
      async () => {
        const subscriptions = await rdb.get('subscriptions');
        if (!subscriptions) {
          return [];
        }
        return Object.keys(subscriptions[cc] || {});
      }
    );
  },
};

// TODO remove this hard coded dev subscription
db.subscribe("The Irons", "965757702376681576");

// Create an express app
const app = express();

// Parse request body and verifies incoming requests using discord-interactions package
app.use(
  "/interactions",
  express.json({ verify: VerifyDiscordRequest(process.env.PUBLIC_KEY) })
);

/**
 * Interactions endpoint URL where Discord will send HTTP requests
 */
app.post("/interactions", async function (req, res) {
  // Interaction type and data
  const { type, id, data, channel_id } = req.body;

  /**
   * Handle verification requests
   */
  if (type === InteractionType.PING) {
    return res.send({ type: InteractionResponseType.PONG });
  }

  /**
   * Handle slash command requests
   * See https://discord.com/developers/docs/interactions/application-commands#slash-commands
   */
  if (type === InteractionType.APPLICATION_COMMAND) {
    const { name } = data;

    if (name === "subscribe") {
      // Send an ACK message and subscribe
      const cc = req.body.data.options[0].value;
      await db.subscribe(cc, channel_id);

      return res.send({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `subscribed channel to CC "${cc}"`,
        },
      });
    }
  }
});

const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  console.log('received connection');
  ws.on('message', async (data) => {
    const { cc, content, sender, timestamp, name } = JSON.parse(data);
    console.log('%s', data);
    console.log(cc, sender, content, timestamp);

    const channels = await db.getChannels(cc);
    for (const channelId of channels) {
      // API endpoint to send message
      const endpoint = `channels/${channelId}/messages`;

      try {
        const body = {
          content: `[${name}]: ${content}`,
          tts: false,
          allow_mentions: false,
        };
        await DiscordRequest(endpoint, { method: "POST", body });
      } catch (err) {
        console.error(err);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Listening on port " + PORT);

  // TODO replace with global commands when ready for release
  // Check if guild commands from commands.json are installed (if not, install them)
  HasGuildCommands(process.env.APP_ID, process.env.GUILD_ID, [
    SUBSCRIBE_COMMAND,
  ]);
});