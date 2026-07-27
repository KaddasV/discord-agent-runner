import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { config } from './config';
import { registerSlashCommands } from './commands';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', async () => {
  console.log(`🤖 Logged in as ${client.user?.tag}`);

  // 1. Register Slash Commands
  await registerSlashCommands();

  // 2. Setup Server Channels
  const guilds = await client.guilds.fetch();
  console.log(`📡 Bot is connected to ${guilds.size} server(s):`);

  for (const [guildId] of guilds) {
    const guild = await client.guilds.fetch(guildId);
    console.log(`   - Server: "${guild.name}" (ID: ${guild.id})`);

    // Check if #agent-runner channel exists
    const channels = await guild.channels.fetch();
    let runnerChannel = channels.find(
      (c) => c && c.type === ChannelType.GuildText && c.name === 'agent-runner'
    ) as TextChannel | undefined;

    if (!runnerChannel) {
      // Find first available text channel bot can send messages in
      runnerChannel = channels.find(
        (c) => c && c.type === ChannelType.GuildText && c.isSendable()
      ) as TextChannel | undefined;
    }

    // Send Welcome & Help Embed if channel is found
    if (runnerChannel) {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 Discord Agent Runner - Ready & Active!')
        .setColor(0x00ffaa)
        .setDescription(
          `Welcome! Control your local PC's AI coding agents (**OpenCode CLI**, **DeepSeek V4**, **Gemini Flash**) remotely from your phone.`
        )
        .addFields(
          {
            name: '📁 `/repo`',
            value: 'Opens a dropdown list of all project repositories on your PC. Pick which repo to work on.',
          },
          {
            name: '⚡ `/task prompt: "..." [model: "..."]`',
            value: 'Runs OpenCode CLI on your PC in the selected repo. Uses `opencode/deepseek-v4-flash-free` by default.',
          },
          {
            name: '🧪 `/verify`',
            value: 'Runs the test & verification suite (`./mvnw test` / `npm test`) on the selected repo.',
          },
          {
            name: '📊 `/status`',
            value: 'Displays active target repository, user binding ID, and task status.',
          },
          {
            name: '🛑 `/cancel`',
            value: 'Terminates any running AI agent task.',
          },
          {
            name: '❓ `/help`',
            value: 'Displays this command reference manual anytime.',
          }
        )
        .setFooter({ text: `User Binding: ${config.myUserId || 'All Users'} | OpenCode CLI v1.18.7` })
        .setTimestamp();

      try {
        await runnerChannel.send({ embeds: [helpEmbed] });
        console.log(`   📩 Posted setup guide to #${runnerChannel.name}`);
      } catch (err) {
        console.warn(`   ⚠️ Could not send welcome message to channel:`, err);
      }
    }
  }

  console.log(`✅ Setup completed successfully.`);
  process.exit(0);
});

client.login(config.discordToken).catch((err) => {
  console.error(`❌ Discord login failed:`, err);
  process.exit(1);
});
