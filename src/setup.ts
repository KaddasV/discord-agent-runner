import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ChannelType,
  TextChannel,
  CategoryChannel,
  PermissionFlagsBits,
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

  // 1. Register Slash Commands globally
  await registerSlashCommands();

  // 2. Setup Server Channels per User
  const guilds = await client.guilds.fetch();
  console.log(`📡 Connected to ${guilds.size} server(s):`);

  for (const [guildId] of guilds) {
    const guild = await client.guilds.fetch(guildId);
    console.log(`   - Server: "${guild.name}" (ID: ${guild.id})`);

    const channels = await guild.channels.fetch();

    // Find or create 'AI AGENT RUNNERS' Category
    let category = channels.find(
      (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('agent')
    ) as CategoryChannel | undefined;

    if (!category) {
      try {
        category = await guild.channels.create({
          name: '🤖 AI AGENT RUNNERS',
          type: ChannelType.GuildCategory,
        });
        console.log(`   ✅ Created category '🤖 AI AGENT RUNNERS'`);
      } catch (err) {
        console.log(`   ℹ️ Category creation skipped or missing permissions.`);
      }
    }

    // Determine channel name for this container's user
    let targetChannelName = 'agent-runner';
    if (config.myUserId) {
      try {
        const user = await client.users.fetch(config.myUserId);
        const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
        targetChannelName = `agent-${cleanName}`;
      } catch (e) {
        console.warn(`Could not fetch user info for ID ${config.myUserId}`);
      }
    }

    // Check if channel already exists
    let dedicatedChannel = channels.find(
      (c) => c && c.type === ChannelType.GuildText && c.name === targetChannelName
    ) as TextChannel | undefined;

    if (!dedicatedChannel) {
      console.log(`   🔨 Creating text channel '#${targetChannelName}'...`);
      try {
        dedicatedChannel = await guild.channels.create({
          name: targetChannelName,
          type: ChannelType.GuildText,
          parent: category?.id,
          topic: `🤖 Dedicated AI Agent Execution Channel for User ID: ${config.myUserId || 'Shared'}`,
        });
        console.log(`   ✅ Successfully created channel '#${targetChannelName}'`);
      } catch (err) {
        console.warn(`   ⚠️ Channel auto-creation failed (missing 'Manage Channels' permission on bot role).`);
        // Fallback to first available sendable channel
        dedicatedChannel = channels.find(
          (c) => c && c.type === ChannelType.GuildText && c.isSendable()
        ) as TextChannel | undefined;
      }
    } else {
      console.log(`   ℹ️ Channel '#${targetChannelName}' already exists.`);
    }

    // Send Welcome & Help Embed to the channel
    if (dedicatedChannel) {
      const helpEmbed = new EmbedBuilder()
        .setTitle(`🤖 AI Agent Control Channel - #${dedicatedChannel.name}`)
        .setColor(0x00ffaa)
        .setDescription(
          `This is your dedicated channel to control your PC's AI coding agents (**OpenCode CLI**, **DeepSeek V4**, **Gemini Flash**) remotely from your phone.`
        )
        .addFields(
          {
            name: '📁 `/repo`',
            value: 'Opens a dropdown list of all project repositories on your PC. Pick which repo to work on.',
          },
          {
            name: '⚡ `/task prompt: "..." [model: "..."]`',
            value: 'Runs OpenCode CLI on your PC in the selected repo. Default model: `opencode/deepseek-v4-flash-free`.',
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
        .setFooter({ text: `Target User ID: ${config.myUserId || 'Shared'} | OpenCode CLI v1.18.7` })
        .setTimestamp();

      try {
        await dedicatedChannel.send({ embeds: [helpEmbed] });
        console.log(`   📩 Sent setup guide to #${dedicatedChannel.name}`);
      } catch (err) {
        console.warn(`   ⚠️ Could not send welcome message to #${dedicatedChannel.name}:`, err);
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
