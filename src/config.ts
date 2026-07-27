import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  discordToken: string;
  clientId: string;
  allowedUserIds: string[];
  defaultModel: string;
  agentCli: string;
  reposDir: string;
  customRepos: Record<string, string>;
}

function parseAllowedUsers(val?: string): string[] {
  if (!val) return [];
  return val.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
}

function parseCustomRepos(val?: string): Record<string, string> {
  if (!val) return {};
  try {
    return JSON.parse(val);
  } catch {
    return {};
  }
}

export const config: AppConfig = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  allowedUserIds: parseAllowedUsers(process.env.ALLOWED_USER_IDS),
  defaultModel: process.env.DEFAULT_MODEL || 'deepseek-v4',
  agentCli: process.env.AGENT_CLI || 'opencode',
  reposDir: process.env.REPOS_DIR || path.resolve(process.env.USERPROFILE || process.env.HOME || 'C:/Users/vdkad'),
  customRepos: parseCustomRepos(process.env.CUSTOM_REPOS),
};
