import fs from 'fs';
import path from 'path';
import { config } from './config';

export interface RepoInfo {
  name: string;
  path: string;
  hasClaudeMd: boolean;
  hasGit: boolean;
}

class RepoManager {
  private activeRepoMap: Map<string, string> = new Map(); // channelId/userId -> repoPath
  private repoCache: { timestamp: number; repos: RepoInfo[] } | null = null;
  private readonly CACHE_TTL_MS = 30000; // 30 seconds TTL

  public discoverRepositories(forceRefresh = false): RepoInfo[] {
    const now = Date.now();
    if (!forceRefresh && this.repoCache && now - this.repoCache.timestamp < this.CACHE_TTL_MS) {
      return this.repoCache.repos;
    }

    const repos: RepoInfo[] = [];
    const baseDir = config.reposDir;

    // First add custom repos from config
    for (const [name, repoPath] of Object.entries(config.customRepos)) {
      if (fs.existsSync(repoPath)) {
        repos.push({
          name,
          path: repoPath,
          hasClaudeMd: fs.existsSync(path.join(repoPath, 'CLAUDE.md')),
          hasGit: fs.existsSync(path.join(repoPath, '.git')),
        });
      }
    }

    // Auto-discover top-level subdirectories in baseDir
    if (fs.existsSync(baseDir)) {
      try {
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const ignoredDirs = [
            'node_modules', 'AppData', 'Application Data', 'Contacts', 'Cookies',
            'Desktop', 'Documents', 'Downloads', 'Favorites', 'Links', 'Local Settings',
            'Music', 'My Documents', 'NetHood', 'OneDrive', 'Pictures', 'PrintHood',
            'Recent', 'Saved Games', 'Searches', 'SendTo', 'Start Menu', 'Templates',
            'Tracing', 'Videos', 'Intel'
          ];
          if (entry.name.startsWith('.') || ignoredDirs.includes(entry.name)) continue;

          const fullPath = path.join(baseDir, entry.name);
          const hasGit = fs.existsSync(path.join(fullPath, '.git'));
          const hasClaudeMd = fs.existsSync(path.join(fullPath, 'CLAUDE.md'));

          if (!repos.some((r) => path.resolve(r.path) === path.resolve(fullPath))) {
            repos.push({
              name: entry.name,
              path: fullPath,
              hasClaudeMd,
              hasGit,
            });
          }
        }
      } catch (err) {
        console.error('Error discovering repositories:', err);
      }
    }

    this.repoCache = { timestamp: Date.now(), repos };
    return repos;
  }

  public setActiveRepo(contextId: string, repoPath: string) {
    this.activeRepoMap.set(contextId, repoPath);
  }

  public getActiveRepo(contextId: string): string | null {
    return this.activeRepoMap.get(contextId) || null;
  }

  public async getRepoFromChannel(channel: any): Promise<string | null> {
    if (!channel) return null;
    const repos = this.discoverRepositories();

    // Try to fetch the full channel object to ensure topic is available
    let topic: string | null = null;
    if (channel.topic && typeof channel.topic === 'string') {
      topic = channel.topic;
    } else if (channel.fetch) {
      try {
        const fetched = await channel.fetch();
        if (fetched.topic && typeof fetched.topic === 'string') {
          topic = fetched.topic;
        }
      } catch (e) {
        // ignore fetch error
      }
    }

    // PRIMARY: Extract exact path from channel topic (source of truth)
    if (topic) {
      const pathMatch = topic.match(/Path:\s*([^\s|]+)/i);
      if (pathMatch && pathMatch[1]) {
        const topicPath = pathMatch[1].trim();
        // Direct path match
        const found = repos.find(r => r.path === topicPath);
        if (found) return found.path;
        // The topic may have been written with a different base path (host vs container)
        // Extract just the repo directory name from the path and match by name
        const topicBaseName = topicPath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
        if (topicBaseName) {
          const foundByName = repos.find(r => r.name.toLowerCase() === topicBaseName.toLowerCase());
          if (foundByName) return foundByName.path;
        }
      }

      // Also try Repository: field
      const repoMatch = topic.match(/Repository:\s*([^\s|]+)/i);
      if (repoMatch && repoMatch[1]) {
        const repoName = repoMatch[1].trim();
        const found = repos.find(r => r.name.toLowerCase() === repoName.toLowerCase());
        if (found) return found.path;
      }
    }

    // FALLBACK: Match by channel name — use exact segment matching
    if (channel.name && typeof channel.name === 'string') {
      if (channel.name.startsWith('repo-')) {
        const cleanChName = channel.name.replace(/^repo-/, '');
        // Sort repos by name length descending so "escapenone-web" matches before "escapenone"
        const sortedRepos = [...repos].sort((a, b) => b.name.length - a.name.length);
        for (const r of sortedRepos) {
          const cleanRepoName = r.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
          // The channel name pattern is: repo-<cleanRepoName>-<cleanUsername>
          // We need an exact match on the repo segment, not a prefix/substring match
          if (cleanChName === cleanRepoName || cleanChName.startsWith(cleanRepoName + '-')) {
            return r.path;
          }
        }
      }
    }

    return null;
  }
}

export const repoManager = new RepoManager();
