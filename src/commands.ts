import { REST, Routes, SlashCommandBuilder, Client } from 'discord.js';
import { config } from './config';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('repo')
    .setDescription('Manage visible repository channels (#repo-...) in your Discord sidebar'),

  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Run any instruction for the AI agent (e.g. ssh somewhere, research a topic, code)')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Instruction for the AI agent (e.g. ssh into prod server and check logs, research topic X)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (e.g. deepseek-v4, gemini-3.6-flash, claude-3-7-sonnet)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create a GitHub ticket/issue for this repository')
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Title of the issue or ticket')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Detailed description, steps, or requirements')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('feature')
    .setDescription('Cut feature branch from dev, implement feature, open PR, auto-merge & deploy')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Description of the feature to implement')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('fix')
    .setDescription('Cut bug fix branch from dev, implement bug fix, open PR, auto-merge & deploy')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Description of the bug or issue to fix')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('release')
    .setDescription('Inspect repo release conventions, bump version, tag, and publish release')
    .addStringOption((option) =>
      option
        .setName('version')
        .setDescription('Target version (e.g. v1.2.0, patch, minor, major, or auto)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('notes')
        .setDescription('Release notes or changelog instructions (optional)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('issues')
    .setDescription('List open GitHub issues for this repository with summaries and tags')
    .addStringOption((option) =>
      option
        .setName('labels')
        .setDescription('Comma-separated labels to filter issues by (optional)')
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('limit')
        .setDescription('Max number of issues to show (default 10, max 25)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('removechannel')
    .setDescription('Permanently delete this repo channel and block it from being auto-recreated'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check current active repository and agent runner status'),

  new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Run test and verification suite on the active repository'),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel any active running AI task on this channel'),

  new SlashCommandBuilder()
    .setName('result')
    .setDescription('Fetch execution logs and results for a completed agent task by ID')
    .addStringOption((option) =>
      option
        .setName('id')
        .setDescription('The Task ID (e.g. REQ-12345 or just 12345)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('followup')
    .setDescription('Queue a follow-up command for a previous task result')
    .addStringOption((option) =>
      option
        .setName('id')
        .setDescription('The previous Task ID to follow up on (e.g. REQ-12345)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Instruction for the follow-up action')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show help and instructions for the Discord Agent Runner'),

  new SlashCommandBuilder()
    .setName('grabissue')
    .setDescription('Grab a non-blocked GitHub issue, implement it, PR, merge & deploy')
    .addStringOption((option) =>
      option
        .setName('labels')
        .setDescription('Comma-separated labels to filter issues by (optional)')
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),
].map((cmd) => cmd.toJSON());

export async function registerSlashCommands(client?: Client) {
  if (!config.discordToken || !config.clientId) {
    console.warn('⚠️ DISCORD_TOKEN or DISCORD_CLIENT_ID missing in .env. Skipping slash command auto-registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  try {
    console.log('🔄 Registering Discord Slash Commands globally...');
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: slashCommands,
    });
    console.log('✅ Successfully registered Discord Slash Commands globally.');

    if (client) {
      for (const [guildId, guild] of client.guilds.cache) {
        try {
          console.log(`🔄 Registering Slash Commands for guild ${guild.name} (${guildId})...`);
          await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
            body: slashCommands,
          });
          console.log(`✅ Successfully registered commands instantly in guild ${guild.name}`);
        } catch (err) {
          console.error(`❌ Failed guild command registration in ${guildId}:`, err);
        }
      }
    }
  } catch (error) {
    console.error('❌ Failed to register Discord Slash Commands:', error);
  }
}
