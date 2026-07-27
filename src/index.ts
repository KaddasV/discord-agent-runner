import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Interaction,
  TextChannel,
  ChannelType,
  CategoryChannel,
} from 'discord.js';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { repoManager } from './repoManager';
import { taskRunner } from './runner';
import { registerSlashCommands } from './commands';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function isInteractionForThisInstance(userId: string): boolean {
  if (config.myUserId) {
    return config.myUserId === userId;
  }
  if (config.allowedUserIds.length > 0) {
    return config.allowedUserIds.includes(userId);
  }
  return true;
}

client.once('ready', async () => {
  console.log(`🤖 Discord Agent Runner ONLINE as ${client.user?.tag}`);
  if (config.myUserId) {
    console.log(`👤 Dedicated Container Instance assigned to Discord User ID: ${config.myUserId}`);
  } else {
    console.log(`🌍 Container Instance listening for shared/allowed users.`);
  }

  await registerSlashCommands();

  // Ensure dedicated channel exists per user/instance
  try {
    const guilds = await client.guilds.fetch();
    for (const [guildId] of guilds) {
      const guild = await client.guilds.fetch(guildId);
      const channels = await guild.channels.fetch();

      let category = channels.find(
        (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('agent')
      ) as CategoryChannel | undefined;

      let targetChannelName = 'agent-runner';
      if (config.myUserId) {
        try {
          const user = await client.users.fetch(config.myUserId);
          const cleanName = user.username.toLowerCase().replace(/[^a-z0-9]/g, '');
          targetChannelName = `agent-${cleanName}`;
        } catch (e) {
          // ignore
        }
      }

      let dedicatedChannel = channels.find(
        (c) => c && c.type === ChannelType.GuildText && c.name === targetChannelName
      ) as TextChannel | undefined;

      if (!dedicatedChannel) {
        try {
          dedicatedChannel = await guild.channels.create({
            name: targetChannelName,
            type: ChannelType.GuildText,
            parent: category?.id,
            topic: `🤖 Dedicated AI Agent Execution Channel for User ID: ${config.myUserId || 'Shared'}`,
          });
          console.log(`✅ Auto-created channel '#${targetChannelName}' in '${guild.name}'`);
        } catch (err) {
          // Ignore missing permissions if channel creation fails
        }
      }
    }
  } catch (err) {
    console.warn('Channel auto-check completed.');
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  const userTag = `${interaction.user.username} (${interaction.user.id})`;
  console.log(`[Interaction] Received ${interaction.type} (command/customId: ${interaction.isChatInputCommand() ? interaction.commandName : (interaction.isStringSelectMenu() ? interaction.customId : 'other')}) from ${userTag}`);

  if (!isInteractionForThisInstance(interaction.user.id)) {
    console.warn(`[Interaction] ⚠️ Ignored unauthorized user ${userTag}. Bound to MY_USER_ID="${config.myUserId}" / ALLOWED="${config.allowedUserIds.join(',')}"`);
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: `⚠️ Unauthorized: This container instance is dedicated to user ID \`${config.myUserId || config.allowedUserIds.join(', ')}\`.`,
        ephemeral: true,
      }).catch(() => {});
    }
    return;
  }

  const contextId = interaction.channelId || interaction.user.id;

  // Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 Discord Agent Runner - Command Reference')
        .setColor(0x5865f2)
        .setDescription('Control your PC\'s AI coding agents remotely from Discord!')
        .addFields(
          { name: '📁 `/repo`', value: 'Select or switch target repository from dropdown menu.' },
          { name: '⚡ `/task prompt: "..." [model: "..."]`', value: 'Run OpenCode agent in selected repo (e.g. `--model opencode/deepseek-v4-flash-free`).' },
          { name: '📊 `/status`', value: 'View current active repo, target user binding, and runner state.' },
          { name: '🧪 `/verify`', value: 'Run test suite (`./mvnw test` / `npm test`) on active repo.' },
          { name: '🛑 `/cancel`', value: 'Kill currently running AI task.' }
        )
        .setFooter({ text: `User Binding: ${config.myUserId || 'Shared'} | OpenCode CLI v1.18.7` });

      await interaction.reply({ embeds: [helpEmbed] });
      return;
    }

    if (commandName === 'repo') {
      console.log(`[Command /repo] Executing for user ${interaction.user.username}`);
      try {
        const repos = repoManager.discoverRepositories();
        console.log(`[Command /repo] Found ${repos.length} repos in ${config.reposDir}`);
        if (repos.length === 0) {
          await interaction.reply({
            content: `⚠️ No repositories found in \`${config.reposDir}\`. Please verify volume mounts or \`REPOS_DIR\` in \`.env\`.`,
            ephemeral: true,
          });
          return;
        }

        const activeRepo = repoManager.getActiveRepo(contextId);

        const options = repos.map((r) => {
          const desc = `${r.hasClaudeMd ? '📄 CLAUDE.md | ' : ''}${r.path}`;
          return {
            label: r.name.slice(0, 100),
            description: desc.slice(0, 100),
            value: r.name.slice(0, 100),
            default: activeRepo === r.path || activeRepo === r.name,
          };
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_repo_${interaction.user.id}`)
          .setPlaceholder('📁 Choose repository to work on...')
          .addOptions(options.slice(0, 25));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const repoEmbed = new EmbedBuilder()
          .setTitle('📂 Repository Selector')
          .setColor(0x00ffaa)
          .setDescription(
            activeRepo
              ? `Current Active Repo: \`${path.basename(activeRepo)}\` (\`${activeRepo}\`)`
              : 'No repository currently selected for this session.'
          );

        await interaction.reply({
          embeds: [repoEmbed],
          components: [row],
        });
        console.log(`[Command /repo] Successfully displayed repository dropdown menu.`);
      } catch (err: any) {
        console.error(`[Command /repo Error] Failed to execute /repo:`, err);
        if (interaction.isRepliable()) {
          await interaction.reply({
            content: `❌ Error executing \`/repo\`: \`${err.message || err}\``,
            ephemeral: true,
          }).catch(() => {});
        }
      }
      return;
    }

    if (commandName === 'status') {
      const activeRepo = repoManager.getActiveRepo(contextId);
      const running = taskRunner.isRunning(contextId);

      const statusEmbed = new EmbedBuilder()
        .setTitle('📊 Agent Runner Status')
        .setColor(running ? 0xffaa00 : 0x00ffbb)
        .addFields(
          { name: 'Target User ID', value: `\`${config.myUserId || 'Any'}\``, inline: true },
          { name: 'Active Repository', value: activeRepo ? `\`${activeRepo}\`` : '❌ None selected (Use `/repo`)', inline: false },
          { name: 'Task Execution Status', value: running ? '⚡ AI Agent is currently RUNNING...' : '💤 Idle', inline: false },
          { name: 'Default Model', value: `\`${config.defaultModel}\``, inline: true },
          { name: 'CLI Tool', value: `\`${config.agentCli}\``, inline: true }
        );

      await interaction.reply({ embeds: [statusEmbed] });
      return;
    }

    if (commandName === 'cancel') {
      const canceled = taskRunner.cancelTask(contextId);
      await interaction.reply({
        content: canceled
          ? '🛑 Successfully killed the running AI agent process.'
          : 'ℹ️ No active task was running on this channel.',
      });
      return;
    }

    if (commandName === 'verify') {
      const activeRepo = repoManager.getActiveRepo(contextId);
      if (!activeRepo) {
        await interaction.reply({
          content: '❌ Please select a repository first using `/repo`.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const repoName = path.basename(activeRepo);
      await interaction.editReply(`🧪 Running verification/tests for **${repoName}** on your PC...`);

      const result = await taskRunner.runVerification(activeRepo);

      const pass = result.exitCode === 0;
      const verifyEmbed = new EmbedBuilder()
        .setTitle(pass ? '✅ Verification Passed' : '❌ Verification Failed')
        .setColor(pass ? 0x00ff00 : 0xff0000)
        .setDescription(`**Repository**: \`${repoName}\`\n\n\`\`\`\n${result.output.slice(-1800)}\n\`\`\``);

      await interaction.editReply({ content: '', embeds: [verifyEmbed] });
      return;
    }

    if (commandName === 'task') {
      const activeRepo = repoManager.getActiveRepo(contextId);
      if (!activeRepo) {
        await interaction.reply({
          content: '❌ No repository selected! Run `/repo` first to choose a project folder.',
          ephemeral: true,
        });
        return;
      }

      if (taskRunner.isRunning(contextId)) {
        await interaction.reply({
          content: '⚠️ A task is already running in this session. Use `/cancel` to stop it first.',
          ephemeral: true,
        });
        return;
      }

      const prompt = interaction.options.getString('prompt', true);
      const model = interaction.options.getString('model') || config.defaultModel;

      await interaction.deferReply();

      const repoName = path.basename(activeRepo);
      const startEmbed = new EmbedBuilder()
        .setTitle(`⚡ Agent Task Launched on [${repoName}]`)
        .setColor(0x3498db)
        .addFields(
          { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Repository', value: `\`${activeRepo}\``, inline: true },
          { name: 'Model', value: `\`${model}\``, inline: true },
          { name: 'Instruction', value: `"${prompt}"` }
        )
        .setFooter({ text: 'Executing locally on developer PC via OpenCode CLI...' });

      await interaction.editReply({ embeds: [startEmbed] });

      const result = await taskRunner.executeTask(contextId, {
        repoPath: activeRepo,
        prompt,
        model,
      });

      const success = result.exitCode === 0;
      const outputSnippet = result.output ? result.output.slice(-1800) : '(No output outputted)';

      const completionEmbed = new EmbedBuilder()
        .setTitle(success ? `✅ Task Completed on [${repoName}]` : `⚠️ Task Finished (Code: ${result.exitCode})`)
        .setColor(success ? 0x2ecc71 : 0xe74c3c)
        .setDescription(`**Output Log:**\n\`\`\`\n${outputSnippet}\n\`\`\``)
        .setTimestamp();

      if (interaction.channel && interaction.channel instanceof TextChannel) {
        await interaction.channel.send({ content: `<@${interaction.user.id}>`, embeds: [completionEmbed] });
      } else {
        await interaction.followUp({ content: `<@${interaction.user.id}>`, embeds: [completionEmbed] });
      }
      return;
    }
  }

  // Handle Dropdown Menu Selection (/repo dropdown)
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_repo')) {
    console.log(`[SelectMenu] Received selection from ${interaction.user.username}:`, interaction.values);
    try {
      const selectedValue = interaction.values[0];
      const repos = repoManager.discoverRepositories();
      const foundRepo = repos.find((r) => r.name === selectedValue || r.path === selectedValue);
      const selectedRepoPath = foundRepo ? foundRepo.path : selectedValue;

      repoManager.setActiveRepo(contextId, selectedRepoPath);

      const repoName = path.basename(selectedRepoPath);
      const hasClaudeMd = fs.existsSync(path.join(selectedRepoPath, 'CLAUDE.md'));

      const activeEmbed = new EmbedBuilder()
        .setTitle(`✅ Target Repository Set: ${repoName}`)
        .setColor(0x2ecc71)
        .setDescription(
          `Target directory set to:\n\`${selectedRepoPath}\`\n\n` +
            `${hasClaudeMd ? '📄 **CLAUDE.md Detected**: OpenCode CLI will respect repository guidelines.\n\n' : ''}` +
            `Send instructions via \`/task prompt: "..."\`.`
        );

      await interaction.update({
        embeds: [activeEmbed],
        components: [],
      });
      console.log(`[SelectMenu] Updated active repo for context ${contextId} to: ${selectedRepoPath}`);
    } catch (err: any) {
      console.error(`[SelectMenu Error] Failed to handle dropdown selection:`, err);
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: `❌ Error setting repository: \`${err.message || err}\``,
          ephemeral: true,
        }).catch(() => {});
      }
    }
    return;
  }
});

client.on('error', (error) => {
  console.error('❌ Discord Client Error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// Start client
if (!config.discordToken) {
  console.error('❌ DISCORD_TOKEN is missing! Please configure .env file.');
  process.exit(1);
}

client.login(config.discordToken);
