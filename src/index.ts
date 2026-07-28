import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  AttachmentBuilder,
  Interaction,
  TextChannel,
  ChannelType,
  CategoryChannel,
  Guild,
  Message,
  PermissionFlagsBits,
} from 'discord.js';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { repoManager } from './repoManager';
import { taskRunner, cleanOpencodeOutput } from './runner';
import { registerSlashCommands } from './commands';
import { saveTaskLog, getTaskLog } from './logStore';

function cleanPromptInput(text: string): string {
  return text.trim().replace(/^["']+|["']+$/g, '').trim();
}

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

async function getOrCreateReleaseChannel(guild: Guild): Promise<TextChannel | null> {
  try {
    const channels = await guild.channels.fetch();
    let category = channels.find(
      (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('agent')
    ) as CategoryChannel | undefined;

    const releaseChannelName = 'agent-releases';
    let releaseChannel = channels.find(
      (c) => c && c.type === ChannelType.GuildText && c.name === releaseChannelName
    ) as TextChannel | undefined;

    if (!releaseChannel) {
      releaseChannel = await guild.channels.create({
        name: releaseChannelName,
        type: ChannelType.GuildText,
        parent: category?.id,
        topic: '🚀 Central Application Redeployments & Release Announcements (All users tagged)',
      });
      console.log(`✅ Auto-created release channel '#${releaseChannelName}' in '${guild.name}'`);
    }
    return releaseChannel || null;
  } catch (err) {
    console.warn(`Failed to get/create release channel in '${guild?.name}':`, err);
    return null;
  }
}

async function ensureUserRepoChannels(guild: Guild, userId?: string, visibleRepos?: string[]) {
  try {
    const repos = repoManager.discoverRepositories();
    const channels = await guild.channels.fetch();
    let category = channels.find(
      (c) => c && c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('agent')
    ) as CategoryChannel | undefined;

    const targetUserIds: string[] = [];
    if (userId) {
      targetUserIds.push(userId);
    } else if (config.myUserId) {
      targetUserIds.push(config.myUserId);
    } else if (config.allowedUserIds.length > 0) {
      targetUserIds.push(...config.allowedUserIds);
    }

    for (const uId of targetUserIds) {
      let cleanUsername = 'user';
      try {
        const u = await client.users.fetch(uId);
        cleanUsername = u.username.toLowerCase().replace(/[^a-z0-9]/g, '');
      } catch (e) {
        // ignore
      }

      for (const repo of repos) {
        const cleanRepoName = repo.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
        const channelName = `repo-${cleanRepoName}-${cleanUsername}`.slice(0, 100);

        let ch = channels.find(
          (c) => c && c.type === ChannelType.GuildText && (c.name === channelName || (c.topic && c.topic.includes(repo.path) && c.topic.includes(uId)))
        ) as TextChannel | undefined;

        const isVisible = !visibleRepos || visibleRepos.includes(repo.path) || visibleRepos.includes(repo.name);

        if (!ch) {
          if (isVisible) {
            try {
              ch = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category?.id,
                topic: `📂 Repository: ${repo.name} | Path: ${repo.path} | User: ${uId}`,
                permissionOverwrites: [
                  {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                  },
                  {
                    id: uId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                  },
                  {
                    id: client.user!.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
                  },
                ],
              });
              console.log(`✅ Auto-created private repo channel '#${channelName}' for user ${uId}`);
            } catch (err) {
              console.warn(`Failed to create repo channel '#${channelName}':`, err);
            }
          }
        } else {
          try {
            await ch.permissionOverwrites.edit(uId, {
              ViewChannel: isVisible,
              SendMessages: isVisible,
              ReadMessageHistory: isVisible,
            });
            console.log(`✅ Updated visibility for repo channel '#${ch.name}' to ${isVisible} for user ${uId}`);
          } catch (err) {
            console.warn(`Failed to update permissions on '${ch.name}':`, err);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Error in ensureUserRepoChannels:', err);
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
      { name: 'Instruction', value: `"${prompt.length > 500 ? prompt.slice(0, 500) + '...' : prompt}"` }
    )
    .setFooter({ text: 'Executing locally on developer PC via OpenCode CLI...' });

  let progressMessage: any = null;
  if (initialInteraction) {
    await initialInteraction.editReply({ embeds: [startEmbed] }).catch(() => {});
  } else {
    try {
      const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
      if (channel) {
        progressMessage = await channel.send({ content: `<@${userId}>`, embeds: [startEmbed] });
      }
    } catch (e) {
      console.error(`[TaskQueue Error] Failed to send startEmbed for ${requestId}:`, e);
    }
  }

  let lastEmbedUpdate = Date.now();
  const updateProgressEmbed = async (fullRawOutput: string) => {
    const now = Date.now();
    if (now - lastEmbedUpdate < 6000) return; // Rate limit Discord embed edits to max once per 6 seconds
    lastEmbedUpdate = now;

    const cleaned = cleanOpencodeOutput(fullRawOutput, 'opencode');
    const snippet = cleaned.slice(-1000).replace(/```/g, "'''");

    const progressEmbed = EmbedBuilder.from(startEmbed)
      .setDescription(`⏳ **Status: In Progress...**\n*Latest Output / Activity:*\n\`\`\`\n${snippet || '(Running...)'}\n\`\`\``);

    if (initialInteraction) {
      await initialInteraction.editReply({ embeds: [progressEmbed] }).catch(() => {});
    } else if (progressMessage) {
      await progressMessage.edit({ embeds: [progressEmbed] }).catch(() => {});
    }
  };

  let result = { exitCode: 1 as number | null, output: '(Error during execution)', rawOutput: '(Error during execution)' };
  try {
    result = await taskRunner.executeTask(contextId, {
      repoPath: activeRepo,
      prompt,
      model,
      timeoutMs: 15 * 60 * 1000,
      onLog: (_chunk, fullOutput) => {
        if (fullOutput) updateProgressEmbed(fullOutput);
      },
    });
  } catch (err: any) {
    result = { exitCode: 1, output: `Exception in executeTask: ${err.message || err}`, rawOutput: `Exception in executeTask: ${err.message || err}` };
  } finally {
    const success = result.exitCode === 0;
    const fullOutputText = result.output || '(No output recorded)';
    const outputSnippet = fullOutputText.slice(-1800);

    saveTaskLog({
      requestId,
      prompt,
      model,
      repo: activeRepo,
      exitCode: result.exitCode,
      output: fullOutputText,
      rawOutput: result.rawOutput,
      timestamp: new Date().toISOString(),
    });

    const completionEmbed = new EmbedBuilder()
      .setTitle(success ? `✅ Task Completed [ID: ${requestId}] on [${repoName}]` : `⚠️ Task Finished [ID: ${requestId}] (Code: ${result.exitCode})`)
      .setColor(success ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        { name: 'Request ID', value: `\`${requestId}\``, inline: true },
        { name: 'Inspect Logs', value: `Use \`/result id:${requestId}\``, inline: true }
      )
      .setDescription(`**Output Log Preview:**\n\`\`\`\n${outputSnippet}\n\`\`\``)
      .setFooter({ text: `Type /result id:${requestId} to retrieve full execution logs & details.` })
      .setTimestamp();

    const followUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`followup_btn_${requestId}`)
        .setLabel('💬 Queue Follow-Up Task')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`view_result_btn_${requestId}`)
        .setLabel('📜 View Detailed Results')
        .setStyle(ButtonStyle.Secondary)
    );

    const isRunnerApp = repoName.toLowerCase().includes('discord-agent-runner');
    const isDeployOrUpdate = /deploy|redeploy|release|docker|push|build|restart|update|pr|merge/i.test(prompt) || /deploy|redeploy|release|docker|push|build|restart|update/i.test(fullOutputText);

    if (isRunnerApp && success && isDeployOrUpdate && guild) {
      try {
        const releaseChannel = await getOrCreateReleaseChannel(guild);
        if (releaseChannel) {
          let userTags = '@here @everyone';
          try {
            const members = await guild.members.fetch();
            const nonBotMembers = members.filter((m) => !m.user.bot);
            if (nonBotMembers.size > 0 && nonBotMembers.size <= 80) {
              userTags = nonBotMembers.map((m) => `<@${m.id}>`).join(' ');
            }
          } catch (intentErr) {
            userTags = '@here @everyone';
          }
          await releaseChannel.send({
            content: `🚨 **APPLICATION REDEPLOYMENT / RELEASE** (${userTags}):\nThe \`discord-agent-runner\` app has just been modified and redeployed! Please pull the latest version and restart your app/container instance (e.g. \`git pull && docker compose up -d --build --force-recreate\`).`,
            embeds: [completionEmbed],
          });
        }
      } catch (e) {
        console.log('[Redeploy Notice] Skipped posting to release channel:', e);
      }
    }

    const replyPayload: any = { content: `<@${userId}> 🔔 Task \`${requestId}\` completed!`, embeds: [completionEmbed], components: [followUpRow] };
    if (result.output && result.output.length > 1800) {
      const buffer = Buffer.from(result.output, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `${requestId}.log` });
      replyPayload.files = [attachment];
    }

    if (initialInteraction) {
      if (initialInteraction.channel && initialInteraction.channel instanceof TextChannel) {
        await initialInteraction.channel.send(replyPayload).catch(() => {});
      } else {
        await initialInteraction.followUp(replyPayload).catch(() => {});
      }
    } else {
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
        if (channel) {
          await channel.send(replyPayload);
        }
      } catch (e) {
        console.error(`[TaskQueue Error] Failed to send completionPayload for ${requestId}:`, e);
      }
    }

    setTimeout(() => {
      processNextInQueue(contextId);
    }, 1000);
  }
}

async function handleAgentCommand(
  interaction: any,
  contextId: string,
  prompt: string,
  model: string,
  commandTitle: string
) {
  let activeRepo = interaction.channel ? repoManager.getRepoFromChannel(interaction.channel) : null;
  if (!activeRepo) {
    activeRepo = repoManager.getActiveRepo(contextId);
  }
  if (activeRepo) {
    repoManager.setActiveRepo(contextId, activeRepo);
  } else {
    await interaction.reply({
      content: '❌ No repository associated with this channel! Please run commands inside your `#repo-...` channels, or use `/repo` to select visible repository channels.',
      ephemeral: true,
    });
    return;
  }

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
      .setTitle(`⏳ ${commandTitle} Queued [ID: ${requestId}]`)
      .setColor(0xf39c12)
      .setDescription(`An agent task is currently executing in this session. Your instruction has been added to the execution queue.`)
      .addFields(
        { name: 'Request ID', value: `\`${requestId}\``, inline: true },
        { name: 'Queue Position', value: `#${queue.length}`, inline: true },
        { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Repository', value: `\`${activeRepo}\``, inline: true },
        { name: 'Model', value: `\`${model}\``, inline: true },
        { name: 'Instruction', value: `"${prompt.length > 300 ? prompt.slice(0, 300) + '...' : prompt}"` }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [queueEmbed] });
    console.log(`[TaskQueue] Enqueued ${commandTitle} ${requestId} for ${contextId}. Queue length: ${queue.length}`);
    return;
  }

  await interaction.deferReply();
  await executeAndReportTask(newTask, interaction);
}

client.once('ready', async () => {
  console.log(`🤖 Discord Agent Runner ONLINE as ${client.user?.tag}`);
  if (config.myUserId) {
    console.log(`👤 Dedicated Container Instance assigned to Discord User ID: ${config.myUserId}`);
  } else {
    console.log(`🌍 Container Instance listening for shared/allowed users.`);
  }

  await registerSlashCommands(client);

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
      await ensureUserRepoChannels(guild);
      await getOrCreateReleaseChannel(guild);
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
          { name: '⚡ `/task prompt: ...`', value: 'Run any instruction for the agent without quotes (ssh somewhere, research a topic, code).' },
          { name: '🎫 `/ticket title: ... description: ...`', value: 'Create a GitHub issue/ticket in this repository without quotes.' },
          { name: '🚀 `/feature prompt: ...`', value: 'Cut feature branch from dev, implement feature, and open a separate GitHub PR.' },
          { name: '🔧 `/fix prompt: ...`', value: 'Cut bug fix branch from dev, implement bug fix, and open a separate GitHub PR.' },
          { name: '📦 `/release [version] [notes]`', value: 'Inspect repo conventions, bump version, tag, and publish release.' },
          { name: '💬 `/followup id: ... prompt: ...`', value: 'Queue a follow-up command for a previous task result.' },
          { name: '💡 **Direct Chat (No Slash Commands Needed)**', value: 'In your dedicated channel, just type regular chat messages (no quotes or `/task` needed) to send prompts instantly!' },
          { name: '📜 `/result id: ...`', value: 'Fetch full execution logs and downloadable log file for a completed task by ID.' },
          { name: '📊 `/status`', value: 'View current active repo, target user binding, and runner state.' },
          { name: '🧪 `/verify`', value: 'Run test suite (`./mvnw test` / `npm test`) on active repo.' },
          { name: '🛑 `/cancel`', value: 'Kill currently running AI task and clear queue.' }
        )
        .setFooter({ text: `User Binding: ${config.myUserId || 'Shared'} | OpenCode CLI v1.18.7` });

      await interaction.reply({ embeds: [helpEmbed] });
      return;
    }

    if (commandName === 'repo') {
      console.log(`[Command /repo] Executing channel manager for user ${interaction.user.username}`);
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

        const channels = interaction.guild ? await interaction.guild.channels.fetch() : null;
        const cleanUsername = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, '');

        const options = repos.map((r) => {
          const desc = `${r.hasClaudeMd ? '📄 CLAUDE.md | ' : ''}${r.path}`;
          const cleanRepoName = r.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
          const channelName = `repo-${cleanRepoName}-${cleanUsername}`.slice(0, 100);
          const ch = channels ? channels.find(c => c && c.type === ChannelType.GuildText && c.name === channelName) : null;
          let isVisible = true;
          if (ch && interaction.guild) {
            const overwrite = ch.permissionOverwrites.cache.get(interaction.user.id);
            if (overwrite && overwrite.deny.has(PermissionFlagsBits.ViewChannel)) {
              isVisible = false;
            }
          }
          return {
            label: r.name.slice(0, 100),
            description: desc.slice(0, 100),
            value: r.name.slice(0, 100),
            default: isVisible,
          };
        });

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`select_repo_${interaction.user.id}`)
          .setPlaceholder('📁 Select repository channels to SHOW in your sidebar...')
          .setMinValues(0)
          .setMaxValues(Math.min(options.length, 25))
          .addOptions(options.slice(0, 25));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        const repoEmbed = new EmbedBuilder()
          .setTitle('📂 Repository Channel Manager')
          .setColor(0x00ffaa)
          .setDescription(
            `Each repository gets a dedicated, private text channel (\`#repo-<name>-...\`).\n\n` +
            `Use the dropdown menu below to select which repository channels you want **visible** in your Discord sidebar. Any unselected repositories will be hidden from your view (message history is preserved).`
          );

        await interaction.reply({
          embeds: [repoEmbed],
          components: [row],
          ephemeral: true,
        });
        console.log(`[Command /repo] Successfully displayed repository channel manager.`);
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

    if (commandName === 'result') {
      const idInput = interaction.options.getString('id', true);
      const logData = getTaskLog(idInput);

      if (!logData) {
        await interaction.reply({
          content: `❌ Could not find execution logs for Task ID \`${idInput}\`. Verify the ID is correct and that the task has completed.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply();

      const success = logData.exitCode === 0;
      const repoName = path.basename(logData.repo || 'unknown');
      const snippet = logData.output ? logData.output.slice(-1800) : '(No output outputted)';

      const resultEmbed = new EmbedBuilder()
        .setTitle(success ? `📜 Execution Log [ID: ${logData.requestId}] - Success` : `📜 Execution Log [ID: ${logData.requestId}] - Error (${logData.exitCode})`)
        .setColor(success ? 0x2ecc71 : 0xe74c3c)
        .addFields(
          { name: 'Request ID', value: `\`${logData.requestId}\``, inline: true },
          { name: 'Status', value: success ? '✅ Success (0)' : `❌ Failed (${logData.exitCode})`, inline: true },
          { name: 'Repository', value: `\`${repoName}\``, inline: true },
          { name: 'Model', value: `\`${logData.model}\``, inline: true },
          { name: 'Timestamp', value: `\`${logData.timestamp}\``, inline: true },
          { name: 'Prompt', value: `"${logData.prompt.length > 200 ? logData.prompt.slice(0, 200) + '...' : logData.prompt}"`, inline: false }
        )
        .setDescription(`**Output Log Preview:**\n\`\`\`\n${snippet}\n\`\`\``)
        .setFooter({ text: 'Use this Request ID to inspect full execution logs anytime.' });

      const followUpRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`followup_btn_${logData.requestId}`)
          .setLabel('💬 Queue Follow-Up Task')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`view_result_btn_${logData.requestId}`)
          .setLabel('📜 View Detailed Results')
          .setStyle(ButtonStyle.Secondary)
      );

      const replyOptions: any = { embeds: [resultEmbed], components: [followUpRow] };

      if (logData.output && logData.output.length > 1800) {
        const buffer = Buffer.from(logData.output, 'utf-8');
        const attachment = new AttachmentBuilder(buffer, { name: `${logData.requestId}.log` });
        replyOptions.files = [attachment];
      }

      await interaction.editReply(replyOptions);
      return;
    }

    if (commandName === 'followup') {
      const parentId = interaction.options.getString('id', true);
      const userPrompt = cleanPromptInput(interaction.options.getString('prompt', true));
      const logData = getTaskLog(parentId);

      if (!logData) {
        await interaction.reply({
          content: `❌ Could not find execution logs for Task ID \`${parentId}\`. Verify the ID is correct.`,
          ephemeral: true,
        });
        return;
      }

      if (logData && logData.repo) {
        repoManager.setActiveRepo(contextId, logData.repo);
      }

      const parentContext = logData ? `\n\n[Context from parent task ${parentId}]: "${logData.prompt.slice(0, 300)}..."` : '';
      const fullPrompt = `${userPrompt}${parentContext}`;
      const model = interaction.options.getString('model') || (logData && logData.model) || config.defaultModel;

      await handleAgentCommand(interaction, contextId, fullPrompt, model, `Follow-Up to ${parentId}`);
      return;
    }

    if (commandName === 'verify') {
      let activeRepo = interaction.channel ? repoManager.getRepoFromChannel(interaction.channel) : null;
      if (!activeRepo) {
        activeRepo = repoManager.getActiveRepo(contextId);
      }
      if (activeRepo) {
        repoManager.setActiveRepo(contextId, activeRepo);
      } else {
        await interaction.reply({
          content: '❌ No repository associated with this channel! Please run verify inside your `#repo-...` channel or select one via `/repo`.',
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
      const userPrompt = cleanPromptInput(interaction.options.getString('prompt', true));
      const model = interaction.options.getString('model') || config.defaultModel;
      await handleAgentCommand(interaction, contextId, userPrompt, model, 'Custom Task');
      return;
    }

    if (commandName === 'ticket') {
      const title = cleanPromptInput(interaction.options.getString('title', true));
      const description = cleanPromptInput(interaction.options.getString('description', true));
      const prompt = `Create a GitHub issue/ticket in this repository with the following details using the GitHub CLI (gh issue create):\n\nTitle: "${title}"\nDescription:\n"${description}"\n\nRun the command and report back the created issue URL.`;
      await handleAgentCommand(interaction, contextId, prompt, config.defaultModel, 'Create Ticket');
      return;
    }

    if (commandName === 'feature') {
      const userPrompt = cleanPromptInput(interaction.options.getString('prompt', true));
      const model = interaction.options.getString('model') || config.defaultModel;
      const prompt = `Implement the following feature in this codebase autonomously:\n\n"${userPrompt}"\n\nExecute the following workflow strictly:\n1. Always fetch the latest changes from remote (git fetch origin), checkout and pull the 'dev' base branch (or 'develop' / 'main'), and cut a new git feature branch strictly from there.\n2. Write code and implement the feature, including tests.\n3. Verify that tests and build pass.\n4. Commit changes and push the feature branch to remote origin.\n5. Create a separate GitHub Pull Request targeting dev (using gh pr create) for history and auditability.\n6. Automatically merge the Pull Request into dev on your own (using gh pr merge --merge or gh pr merge --auto --merge).\n7. Ensure the latest version of the application is built and running (e.g. via docker compose up -d --build or deployment scripts).\nReport the PR link, merge status, and deployment results when finished.`;
      await handleAgentCommand(interaction, contextId, prompt, model, 'Feature Implementation & Deploy');
      return;
    }

    if (commandName === 'fix') {
      const userPrompt = cleanPromptInput(interaction.options.getString('prompt', true));
      const model = interaction.options.getString('model') || config.defaultModel;
      const prompt = `Implement the following bug fix in this codebase autonomously:\n\n"${userPrompt}"\n\nExecute the following workflow strictly:\n1. Always fetch the latest changes from remote (git fetch origin), checkout and pull the 'dev' base branch (or 'develop' / 'main'), and cut a new git bug fix branch (fix/...) strictly from there.\n2. Write code and implement the fix, including tests.\n3. Verify that tests and build pass.\n4. Commit changes and push the fix branch to remote origin.\n5. Create a separate GitHub Pull Request targeting dev (using gh pr create) for history and auditability.\n6. Automatically merge the Pull Request into dev on your own (using gh pr merge --merge or gh pr merge --auto --merge).\n7. Ensure the latest version of the application is built and running (e.g. via docker compose up -d --build or deployment scripts).\nReport the PR link, merge status, and deployment results when finished.`;
      await handleAgentCommand(interaction, contextId, prompt, model, 'Bug Fix & Deploy');
      return;
    }

    if (commandName === 'release') {
      const version = interaction.options.getString('version') || 'auto (determine next logical version from repo conventions and history)';
      const notes = interaction.options.getString('notes') || 'Generate changelog automatically from recent commits and PRs.';
      const model = interaction.options.getString('model') || config.defaultModel;
      const prompt = `Perform a project release for this repository autonomously.\n\nTarget Version: ${version}\nRelease Notes / Instructions: ${notes}\n\nExecute the following release workflow strictly:\n1. Inspect the repository structure, CLAUDE.md, README, package.json, pom.xml, build.gradle, or CI/CD scripts/workflows to understand how this specific repository handles versioning and releases.\n2. Ensure working directory is clean and on the appropriate release branch (e.g. main, master, or develop depending on repo convention). Pull latest changes.\n3. Bump version numbers in configuration files (e.g. package.json, pom.xml, etc.) as required by repo conventions.\n4. Generate or update changelog/release notes.\n5. Commit the version bump and create a git tag for the release (e.g. git tag -a v... -m "...").\n6. Push commits and tags to remote origin (git push origin --tags).\n7. If GitHub Releases are used, create a GitHub Release using the GitHub CLI (gh release create) with the generated release notes.\n8. Trigger or verify any build, publishing, or deployment pipelines associated with releases in this repository.\nReport the released version, tag URL, GitHub release link, and publishing status when finished.`;
      await handleAgentCommand(interaction, contextId, prompt, model, 'Project Release');
      return;
    }
  }

  // Handle Dropdown Menu Selection (/repo dropdown)
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_repo')) {
    console.log(`[SelectMenu] Received selection from ${interaction.user.username}:`, interaction.values);
    try {
      if (!interaction.guild) {
        await interaction.update({
          content: `⚠️ Repository channel management is only available within a Discord server (guild).`,
          embeds: [],
          components: [],
        });
        return;
      }

      const selectedValues = interaction.values;
      await ensureUserRepoChannels(interaction.guild, interaction.user.id, selectedValues);

      const activeEmbed = new EmbedBuilder()
        .setTitle(`✅ Repository Channels Updated`)
        .setColor(0x2ecc71)
        .setDescription(
          `We have updated your visible repository channels in this server.\n\n` +
            `Selected Repositories Visible: \`${selectedValues.length}\`\n\n` +
            `Check your Discord sidebar for your dedicated \`#repo-...\` channels! Work related to each repo should be requested directly inside its respective channel.`
        );

      await interaction.update({
        embeds: [activeEmbed],
        components: [],
      });
      console.log(`[SelectMenu] Updated visible repo channels for user ${interaction.user.id}:`, selectedValues);
    } catch (err: any) {
      console.error(`[SelectMenu Error] Failed to handle dropdown selection:`, err);
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: `❌ Error updating repository channels: \`${err.message || err}\``,
          ephemeral: true,
        }).catch(() => {});
      }
    }
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('followup_btn_')) {
    const parentId = interaction.customId.replace('followup_btn_', '');
    const modal = new ModalBuilder()
      .setCustomId(`modal_followup_${parentId}`)
      .setTitle(`Follow-Up to ${parentId.slice(-10)}`);

    const promptInput = new TextInputBuilder()
      .setCustomId('followup_prompt_input')
      .setLabel('What should the agent do next?')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('e.g. Fix the failing test on line 42 and re-run verify')
      .setRequired(true);

    const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(promptInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith('view_result_btn_')) {
    const idInput = interaction.customId.replace('view_result_btn_', '');
    const logData = getTaskLog(idInput);

    if (!logData) {
      await interaction.reply({
        content: `❌ Could not find execution logs for Task ID \`${idInput}\`. Verify the ID is correct and that the task has completed.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const success = logData.exitCode === 0;
    const repoName = path.basename(logData.repo || 'unknown');
    const snippet = logData.output ? logData.output.slice(-1800) : '(No output recorded)';

    const resultEmbed = new EmbedBuilder()
      .setTitle(success ? `📜 Detailed Results [ID: ${logData.requestId}] - Success` : `📜 Detailed Results [ID: ${logData.requestId}] - Error (${logData.exitCode})`)
      .setColor(success ? 0x2ecc71 : 0xe74c3c)
      .addFields(
        { name: 'Request ID', value: `\`${logData.requestId}\``, inline: true },
        { name: 'Status', value: success ? '✅ Success (0)' : `❌ Failed (${logData.exitCode})`, inline: true },
        { name: 'Repository', value: `\`${repoName}\``, inline: true },
        { name: 'Model', value: `\`${logData.model}\``, inline: true },
        { name: 'Timestamp', value: `\`${logData.timestamp}\``, inline: true },
        { name: 'Prompt', value: `"${logData.prompt.length > 200 ? logData.prompt.slice(0, 200) + '...' : logData.prompt}"`, inline: false }
      )
      .setDescription(`**Output Log Preview:**\n\`\`\`\n${snippet}\n\`\`\``)
      .setFooter({ text: 'Full execution log file is attached below if output is long.' });

    const replyOptions: any = { embeds: [resultEmbed] };

    if (logData.output && logData.output.length > 0) {
      const buffer = Buffer.from(logData.output, 'utf-8');
      const attachment = new AttachmentBuilder(buffer, { name: `${logData.requestId}.log` });
      replyOptions.files = [attachment];
    }

    await interaction.editReply(replyOptions);
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_followup_')) {
    const parentId = interaction.customId.replace('modal_followup_', '');
    const logData = getTaskLog(parentId);
    const userPrompt = cleanPromptInput(interaction.fields.getTextInputValue('followup_prompt_input'));

    const contextId = interaction.channelId || interaction.user.id;
    if (logData && logData.repo) {
      repoManager.setActiveRepo(contextId, logData.repo);
    }

    const parentContext = logData ? `\n\n[Context from parent task ${parentId}]: "${logData.prompt.slice(0, 300)}..."` : '';
    const fullPrompt = `${userPrompt}${parentContext}`;
    const model = (logData && logData.model) || config.defaultModel;

    await handleAgentCommand(interaction as any, contextId, fullPrompt, model, `Follow-Up to ${parentId}`);
    return;
  }
});

client.on('messageCreate', async (message: Message) => {
  if (message.author.bot) return;

  if (!isInteractionForThisInstance(message.author.id)) {
    return;
  }

  // Ignore commands starting with '/' or task result IDs
  if (message.content.startsWith('/') || message.content.startsWith('REQ-')) return;

  const contextId = message.channelId || message.author.id;
  let activeRepo = message.channel ? repoManager.getRepoFromChannel(message.channel) : null;
  if (!activeRepo) {
    activeRepo = repoManager.getActiveRepo(contextId);
  }
  if (activeRepo) {
    repoManager.setActiveRepo(contextId, activeRepo);
  }

  let isAgentChannel = false;
  if (message.channel && 'name' in message.channel && typeof message.channel.name === 'string') {
    const chName = message.channel.name.toLowerCase();
    if (chName.startsWith('agent-') || chName.startsWith('repo-')) {
      isAgentChannel = true;
    }
  }

  // Only trigger on direct chat if an active repo is set or it's a dedicated agent channel
  if (!activeRepo && !isAgentChannel) {
    return;
  }

  const prompt = cleanPromptInput(message.content);
  if (!prompt) return;

  console.log(`[MessageCreate] Received direct chat prompt from ${message.author.username} in channel ${message.channelId}: "${prompt}"`);

  const messageAdapter = {
    user: message.author,
    channel: message.channel,
    channelId: message.channelId,
    guild: message.guild || null,
    isRepliable: () => true,
    replyMessage: null as any,
    deferReply: async () => {
      try {
        const sent = await message.reply({ content: '⏳ Preparing agent task...' });
        messageAdapter.replyMessage = sent;
        return sent;
      } catch (e) {
        // ignore
      }
    },
    reply: async (opts: any) => {
      if (messageAdapter.replyMessage) {
        return await messageAdapter.replyMessage.edit(opts).catch(() => {});
      } else {
        const sent = await message.reply(opts).catch(() => {});
        messageAdapter.replyMessage = sent;
        return sent;
      }
    },
    editReply: async (opts: any) => {
      if (messageAdapter.replyMessage) {
        return await messageAdapter.replyMessage.edit(opts).catch(() => {});
      } else {
        const sent = await message.reply(opts).catch(() => {});
        messageAdapter.replyMessage = sent;
        return sent;
      }
    },
    followUp: async (opts: any) => {
      return await message.reply(opts).catch(() => {});
    },
  };

  await handleAgentCommand(messageAdapter as any, contextId, prompt, config.defaultModel, 'Direct Chat Task');
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
