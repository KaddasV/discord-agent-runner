import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  Interaction,
  TextChannel,
} from 'discord.js';
import path from 'path';
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

function isUserAllowed(userId: string): boolean {
  if (config.allowedUserIds.length === 0) return true; // If empty, allow anyone on server
  return config.allowedUserIds.includes(userId);
}

client.once('ready', async () => {
  console.log(`🤖 Discord Agent Runner is ONLINE as ${client.user?.tag}`);
  await registerSlashCommands();
});

client.on('interactionCreate', async (interaction: Interaction) => {
  if (!isUserAllowed(interaction.user.id)) {
    if (interaction.isRepliable()) {
      await interaction.reply({
        content: '⛔ Security Restriction: Your Discord User ID is not authorized to control this agent runner.',
        ephemeral: true,
      });
    }
    return;
  }

  const contextId = interaction.channelId || interaction.user.id;

  // Handle Slash Commands
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🤖 Discord Agent Runner - Help')
        .setColor(0x5865f2)
        .setDescription('Control your PC\'s AI coding agents remotely from Discord!')
        .addFields(
          { name: '/repo', value: 'Select or switch target repository from dropdown menu.' },
          { name: '/task <prompt> [model]', value: 'Run OpenCode agent in selected repo (e.g. `--model deepseek-v4`).' },
          { name: '/status', value: 'View current active repo and running background task.' },
          { name: '/verify', value: 'Run verification suite (`./mvnw test` / `npm test`) on active repo.' },
          { name: '/cancel', value: 'Kill currently running AI task.' }
        )
        .setFooter({ text: 'Powered by OpenCode CLI & Discord.js' });

      await interaction.reply({ embeds: [helpEmbed] });
      return;
    }

    if (commandName === 'repo') {
      const repos = repoManager.discoverRepositories();
      if (repos.length === 0) {
        await interaction.reply({
          content: `⚠️ No repositories found in \`${config.reposDir}\`. Please check your configuration or add repos in \`.env\`.`,
          ephemeral: true,
        });
        return;
      }

      const activeRepo = repoManager.getActiveRepo(contextId);

      const options = repos.map((r) => ({
        label: r.name,
        description: `${r.hasClaudeMd ? '📄 CLAUDE.md | ' : ''}${r.path}`,
        value: r.path,
        default: activeRepo === r.path,
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_repo')
        .setPlaceholder('📁 Choose repository to work on...')
        .addOptions(options.slice(0, 25)); // Discord dropdown limit: 25 items

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

      const repoEmbed = new EmbedBuilder()
        .setTitle('📂 Repository Selector')
        .setColor(0x00ffaa)
        .setDescription(
          activeRepo
            ? `Current Active Repo: \`${path.basename(activeRepo)}\` (\`${activeRepo}\`)`
            : 'No repository currently selected for this channel.'
        );

      await interaction.reply({
        embeds: [repoEmbed],
        components: [row],
      });
      return;
    }

    if (commandName === 'status') {
      const activeRepo = repoManager.getActiveRepo(contextId);
      const running = taskRunner.isRunning(contextId);

      const statusEmbed = new EmbedBuilder()
        .setTitle('📊 Agent Runner Status')
        .setColor(running ? 0xffaa00 : 0x00ffbb)
        .addFields(
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
      await interaction.editReply(`🧪 Running verification/tests for **${repoName}**...`);

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
          content: '⚠️ A task is already running in this channel. Use `/cancel` to stop it first.',
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
          { name: 'Repository', value: `\`${activeRepo}\``, inline: true },
          { name: 'Model', value: `\`${model}\``, inline: true },
          { name: 'Instruction', value: `"${prompt}"` }
        )
        .setFooter({ text: 'Executing locally on PC via OpenCode CLI...' });

      await interaction.editReply({ embeds: [startEmbed] });

      // Execute task
      let lastUpdateMessage = '';
      const updateDebounced = async (outputChunk: string) => {
        // Send status updates if long running (optional log snippet)
      };

      const result = await taskRunner.executeTask(contextId, {
        repoPath: activeRepo,
        prompt,
        model,
        onLog: updateDebounced,
      });

      const success = result.exitCode === 0;
      const outputSnippet = result.output ? result.output.slice(-1800) : '(No output outputted)';

      const completionEmbed = new EmbedBuilder()
        .setTitle(success ? `✅ Task Completed on [${repoName}]` : `⚠️ Task Finished (Code: ${result.exitCode})`)
        .setColor(success ? 0x2ecc71 : 0xe74c3c)
        .setDescription(`**Output Log:**\n\`\`\`\n${outputSnippet}\n\`\`\``)
        .setTimestamp();

      if (interaction.channel && interaction.channel instanceof TextChannel) {
        await interaction.channel.send({ embeds: [completionEmbed] });
      } else {
        await interaction.followUp({ embeds: [completionEmbed] });
      }
      return;
    }
  }

  // Handle Dropdown Menu Selection (/repo dropdown)
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_repo') {
    const selectedRepoPath = interaction.values[0];
    repoManager.setActiveRepo(contextId, selectedRepoPath);

    const repoName = path.basename(selectedRepoPath);
    const hasClaudeMd = require('fs').existsSync(path.join(selectedRepoPath, 'CLAUDE.md'));

    const activeEmbed = new EmbedBuilder()
      .setTitle(`✅ Selected Repository: ${repoName}`)
      .setColor(0x2ecc71)
      .setDescription(
        `Target directory set to:\n\`${selectedRepoPath}\`\n\n` +
          `${hasClaudeMd ? '📄 **CLAUDE.md Detected**: OpenCode CLI will respect existing repository rules.\n\n' : ''}` +
          `Now send commands via \`/task prompt: "..."\`.`
      );

    await interaction.update({
      embeds: [activeEmbed],
      components: [],
    });
    return;
  }
});

// Start client
if (!config.discordToken) {
  console.error('❌ DISCORD_TOKEN is missing! Please configure .env file.');
  process.exit(1);
}

client.login(config.discordToken);
