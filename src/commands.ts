import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { config } from './config';

export const slashCommands = [
  new SlashCommandBuilder()
    .setName('repo')
    .setDescription('Select or change the target repository for AI operations'),

  new SlashCommandBuilder()
    .setName('task')
    .setDescription('Run any instruction for the AI agent (e.g. ssh somewhere, research a topic, code)')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Instruction for the AI agent (e.g. "ssh into prod server and check logs", "research topic X")')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (e.g. "deepseek-v4", "gemini-3.6-flash", "claude-3-7-sonnet")')
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
    .setDescription('Implement a feature, create a PR, merge it, and deploy')
    .addStringOption((option) =>
      option
        .setName('prompt')
        .setDescription('Description of the feature to implement and deploy')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('model')
        .setDescription('AI model override (optional)')
        .setRequired(false)
    ),

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
].map((cmd) => cmd.toJSON());

export async function registerSlashCommands() {
  if (!config.discordToken || !config.clientId) {
    console.warn('⚠️ DISCORD_TOKEN or DISCORD_CLIENT_ID missing in .env. Skipping slash command auto-registration.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  try {
    console.log('🔄 Registering Discord Slash Commands...');
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: slashCommands,
    });
    console.log('✅ Successfully registered Discord Slash Commands globally.');
  } catch (error) {
    console.error('❌ Failed to register Discord Slash Commands:', error);
  }
}
