import fs from 'fs';
import path from 'path';

/**
 * Persistent channel-to-repo mapping.
 * 
 * Instead of fuzzy-matching channel names or parsing topics at runtime,
 * we persist an explicit { channelId: repoPath } map to a JSON file.
 * This is the SINGLE SOURCE OF TRUTH for which Discord channel maps to which repo.
 * 
 * The map is written when channels are created in ensureUserRepoChannels(),
 * and read when resolving which repo a command should execute against.
 */

const MAP_FILE = path.join(process.env.TASK_LOG_DIR || './task_logs', 'channel-repo-map.json');

interface ChannelRepoMapping {
  [channelId: string]: {
    repoPath: string;
    repoName: string;
    channelName: string;
    userId: string;
    updatedAt: string;
  };
}

let cachedMap: ChannelRepoMapping | null = null;

function ensureDir(): void {
  const dir = path.dirname(MAP_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadMap(): ChannelRepoMapping {
  if (cachedMap) return cachedMap;
  try {
    if (fs.existsSync(MAP_FILE)) {
      const raw = fs.readFileSync(MAP_FILE, 'utf-8');
      cachedMap = JSON.parse(raw);
      return cachedMap!;
    }
  } catch (err) {
    console.warn('[ChannelRepoMap] Failed to load map file, starting fresh:', err);
  }
  cachedMap = {};
  return cachedMap;
}

function saveMap(map: ChannelRepoMapping): void {
  ensureDir();
  cachedMap = map;
  try {
    fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2), 'utf-8');
  } catch (err) {
    console.error('[ChannelRepoMap] Failed to save map file:', err);
  }
}

/**
 * Register a channel → repo mapping.
 * Called when a repo channel is created or discovered.
 */
export function registerChannelRepo(
  channelId: string,
  repoPath: string,
  repoName: string,
  channelName: string,
  userId: string
): void {
  const map = loadMap();
  map[channelId] = {
    repoPath,
    repoName,
    channelName,
    userId,
    updatedAt: new Date().toISOString(),
  };
  saveMap(map);
  console.log(`[ChannelRepoMap] Registered: #${channelName} (${channelId}) → ${repoPath}`);
}

/**
 * Look up the repo path for a given channel ID.
 * Returns null if no mapping exists.
 */
export function getRepoForChannel(channelId: string): string | null {
  const map = loadMap();
  const entry = map[channelId];
  return entry ? entry.repoPath : null;
}

/**
 * Remove a channel mapping (e.g. if channel is deleted).
 */
export function removeChannelMapping(channelId: string): void {
  const map = loadMap();
  if (map[channelId]) {
    delete map[channelId];
    saveMap(map);
  }
}

/**
 * Get all registered mappings (for debugging/logging).
 */
export function getAllMappings(): ChannelRepoMapping {
  return loadMap();
}

/**
 * Force reload from disk (useful after external edits).
 */
export function reloadMap(): void {
  cachedMap = null;
  loadMap();
}
