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
  Guild,
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

async function getOrCreateResultsChannel(guild: Guild): Promise<TextChannel | null> {
  try {
    const channels = await guild.channels.fetch();
    let category = channels.find(
      (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('agent')
    ) as CategoryChannel | undefined;

    const resultsChannelName = 'agent-results';
    let resultsChannel = channels.find(
      (c) => c && c.type === ChannelType.GuildText && c.name === resultsChannelName
    ) as TextChannel | undefined;

    if (!resultsChannel) {
      resultsChannel = await guild.channels.create({
        name: resultsChannelName,
        type: ChannelType.GuildText,
        parent: category?.id,
        topic: '📊 Task Execution Results & Status Notifications (Whether prompts finished or not)',
      });
      console.log(`✅ Auto-created results channel '#${resultsChannelName}' in '${guild.name}'`);
    }
    return resultsChannel || null;
  } catch (err) {
    console.warn(`Failed to get/create results channel in '${guild?.name}':`, err);
    return null;
  }
}

interface QueuedTask {
  requestId: string;
  contextId: string;
  activeRepo: string;
  prompt: string;
  model: string;
  userId: string;
  channelId: string;
  guild: Guild | null;
}

const taskQueue: Map<string, Array<QueuedTask>> = new Map();

async function processNextInQueue(contextId: string): Promise<void> {
  if (taskRunner.isRunning(contextId)) {
    return;
  }
  const queue = taskQueue.get(contextId);
  if (!queue || queue.length === 0) {
    return;
  }
  const nextTask = queue.shift();
  if (nextTask) {
    console.log(`[TaskQueue] Dequeuing and starting task ${nextTask.requestId} for ${contextId}. Remaining in queue: ${queue.length}`);
    await executeAndReportTask(nextTask);
  }
}

async function executeAndReportTask(task: QueuedTask, initialInteraction?: any): Promise<void> {
  const { requestId, contextId, activeRepo, prompt, model, userId, channelId, guild } = task;
  const repoName = path.basename(activeRepo);

  const startEmbed = new EmbedBuilder()
    .setTitle(`⚡ Agent Task Launched [ID: ${requestId}] on [${repoName}]`)
    .setColor(0x3498db)
    .addFields(
      { name: 'Request ID', value: `\`${requestId}\``, inline: true },
      { name: 'User', value: `<@${userId}>`, inline: true },
      { name: 'Repository', value: `\`${activeRepo}\``, inline: true },
      { name: 'Model', value: `\`${model}\``, inline: true },
      { name: 'Instruction', value: `"${prompt}"` }
    )
    .setFooter({ text: 'Executing locally on developer PC via OpenCode CLI...' });

  if (initialInteraction) {
    await initialInteraction.editReply({ embeds: [startEmbed] }).catch(() => {});
  } else {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
      if (channel) {
        await channel.send({ content: `<@${userId}>`, embeds: [startEmbed] });
      }
    } catch (e) {
      console.error(`[TaskQueue Error] Failed to send startEmbed for ${requestId}:`, e);
    }
  }

  let result = { exitCode: 1 as number | null, output: '(Error during execution)' };
  try {
    result = await taskRunner.executeTask(contextId, {
      repoPath: activeRepo,
      prompt,
      model,
    });
  } catch (err: any) {
    result = { exitCode: 1, output: `Exception in executeTask: ${err.message || err}` };
  } finally {
    const success = result.exitCode === 0;
    const outputSnippet = result.output ? result.output.slice(-1800) : '(No output outputted)';

    const completionEmbed = new EmbedBuilder()
      .setTitle(success ? `✅ Task Completed [ID: ${requestId}] on [${repoName}]` : `⚠️ Task Finished [ID: ${requestId}] (Code: ${result.exitCode})`)
      .setColor(success ? 0x2ecc71 : 0xe74c3c)
      .addFields({ name: 'Request ID', value: `\`${requestId}\``, inline: true })
      .setDescription(`**Output Log:**\n\`\`\`\n${outputSnippet}\n\`\`\``)
      .setTimestamp();

    if (initialInteraction) {
      if (initialInteraction.channel && initialInteraction.channel instanceof TextChannel) {
        await initialInteraction.channel.send({ content: `<@${userId}>`, embeds: [completionEmbed] }).catch(() => {});
      } else {
        await initialInteraction.followUp({ content: `<@${userId}>`, embeds: [completionEmbed] }).catch(() => {});
      }
    } else {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
        if (channel) {
          await channel.send({ content: `<@${userId}>`, embeds: [completionEmbed] });
        }
      } catch (e) {
        console.error(`[TaskQueue Error] Failed to send completionEmbed for ${requestId}:`, e);
      }
    }

    if (guild) {
      try {
        const resultsChannel = await getOrCreateResultsChannel(guild);
        if (resultsChannel) {
          const statusEmbed = new EmbedBuilder()
            .setTitle(success ? `✅ Task Execution Finished [${requestId}]` : `❌ Task Execution Failed [${requestId}]`)
            .setColor(success ? 0x2ecc71 : 0xe74c3c)
            .setDescription(success ? `The OpenCode prompt executed and finished successfully.` : `The OpenCode prompt failed during execution (Exit Code: ${result.exitCode}).`)
            .addFields(
              { name: 'Request ID', value: `\`${requestId}\``, inline: true },
              { name: 'Status', value: success ? '✅ Finished Successfully' : `❌ Error (${result.exitCode})`, inline: true },
              { name: 'User', value: `<@${userId}>`, inline: true },
              { name: 'Repository', value: `\`${repoName}\``, inline: true },
              { name: 'Channel', value: `<#${channelId}>`, inline: true },
              { name: 'Model', value: `\`${model}\``, inline: true },
              { name: 'Prompt', value: `"${prompt.length > 250 ? prompt.slice(0, 250) + '...' : prompt}"`, inline: false }
            )
            .setTimestamp();

          await resultsChannel.send({ embeds: [statusEmbed] });
          console.log(`[TaskResult] Posted completion status for ${requestId} to #${resultsChannel.name}`);
        }
      } catch (err) {
        console.error(`[TaskResult Error] Failed to send notification to results channel:`, err);
      }
    }

    setTimeout(() => {
      processNextInQueue(contextId);
    }, 1000);
  }
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

      await getOrCreateResultsChannel(guild);
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
      const queue = taskQueue.get(contextId) || [];

      const statusEmbed = new EmbedBuilder()
        .setTitle('📊 Agent Runner Status')
        .setColor(running ? 0xffaa00 : 0x00ffbb)
        .addFields(
          { name: 'Target User ID', value: `\`${config.myUserId || 'Any'}\``, inline: true },
          { name: 'Active Repository', value: activeRepo ? `\`${activeRepo}\`` : '❌ None selected (Use `/repo`)', inline: false },
          { name: 'Task Execution Status', value: running ? '⚡ AI Agent is currently RUNNING...' : '💤 Idle', inline: false },
          { name: 'Queued Tasks', value: queue.length > 0 ? `⏳ \`${queue.length}\` task(s) waiting in queue` : '0', inline: true },
          { name: 'Default Model', value: `\`${config.defaultModel}\``, inline: true },
          { name: 'CLI Tool', value: `\`${config.agentCli}\``, inline: true }
        );

      await interaction.reply({ embeds: [statusEmbed] });
      return;
    }

    if (commandName === 'cancel') {
      const canceled = taskRunner.cancelTask(contextId);
      const queue = taskQueue.get(contextId) || [];
      const queueCount = queue.length;
      taskQueue.set(contextId, []); // Clear queue

      let msg = '';
      if (canceled && queueCount > 0) {
        msg = `🛑 Successfully killed the running AI agent process and cleared \`${queueCount}\` queued task(s).`;
      } else if (canceled) {
        msg = '🛑 Successfully killed the running AI agent process.';
      } else if (queueCount > 0) {
        msg = `🛑 Cleared \`${queueCount}\` queued task(s) (no active task was running).`;
      } else {
        msg = 'ℹ️ No active task or queued tasks found on this channel.';
      }

      await interaction.reply({ content: msg });
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

      const prompt = interaction.options.getString('prompt', true);
      const model = interaction.options.getString('model') || config.defaultModel;
      const requestId = `REQ-${Date.now().toString().slice(-5)}${Math.floor(10 + Math.random() * 90)}`;

      const newTask: QueuedTask = {
        requestId,
        contextId,
        activeRepo,
        prompt,
        model,
        userId: interaction.user.id,
        channelId: interaction.channelId || interaction.user.id,
        guild: interaction.guild || null,
      };

      const queue = taskQueue.get(contextId) || [];
      if (taskRunner.isRunning(contextId) || queue.length > 0) {
        queue.push(newTask);
        taskQueue.set(contextId, queue);

        await interaction.deferReply();
        const queueEmbed = new EmbedBuilder()
          .setTitle(`⏳ Agent Task Queued [ID: ${requestId}]`)
          .setColor(0xf39c12)
          .setDescription(`An agent task is currently executing in this session. Your instruction has been added to the execution queue.`)
          .addFields(
            { name: 'Request ID', value: `\`${requestId}\``, inline: true },
            { name: 'Queue Position', value: `#${queue.length}`, inline: true },
            { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Repository', value: `\`${activeRepo}\``, inline: true },
            { name: 'Model', value: `\`${model}\``, inline: true },
            { name: 'Instruction', value: `"${prompt}"` }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [queueEmbed] });
        console.log(`[TaskQueue] Enqueued task ${requestId} for ${contextId}. Queue length: ${queue.length}`);
        return;
      }

      await interaction.deferReply();
      await executeAndReportTask(newTask, interaction);
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
