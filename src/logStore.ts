import fs from 'fs';
import path from 'path';

export interface TaskLogMetadata {
  requestId: string;
  prompt: string;
  model: string;
  repo: string;
  exitCode: number | null;
  output: string;
  rawOutput?: string;
  timestamp: string;
}

const LOGS_DIR = path.join(process.cwd(), 'task_logs');

// Ensure directory exists on startup
try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch (err) {
  console.error('[LogStore] Failed to create task_logs directory:', err);
}

const memoryStore: Map<string, TaskLogMetadata> = new Map();

export function saveTaskLog(metadata: TaskLogMetadata): void {
  const { requestId } = metadata;
  const upperId = requestId.toUpperCase();
  memoryStore.set(upperId, metadata);

  try {
    const dateStr = new Date(metadata.timestamp || Date.now()).toISOString().split('T')[0];
    const dateDir = path.join(LOGS_DIR, dateStr);
    if (!fs.existsSync(dateDir)) {
      fs.mkdirSync(dateDir, { recursive: true });
    }
    // Save inside date folder
    const jsonPath = path.join(dateDir, `${upperId}.json`);
    const logPath = path.join(dateDir, `${upperId}.log`);

    const logContent = metadata.rawOutput || metadata.output || '(No output log recorded)';
    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf-8');
    fs.writeFileSync(logPath, logContent, 'utf-8');

    // Also write to root LOGS_DIR for fast lookup
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(LOGS_DIR, `${upperId}.json`), JSON.stringify(metadata, null, 2), 'utf-8');
    fs.writeFileSync(path.join(LOGS_DIR, `${upperId}.log`), logContent, 'utf-8');

    console.log(`[LogStore] Saved logs for ${upperId} to ${dateDir} and root disk.`);
  } catch (err) {
    console.error(`[LogStore] Error writing log files for ${upperId}:`, err);
  }
}

export function getTaskLog(idInput: string): TaskLogMetadata | null {
  const cleanId = idInput.trim().toUpperCase();
  let candidates = [cleanId];
  if (!cleanId.startsWith('REQ-')) {
    candidates.push(`REQ-${cleanId}`);
  }

  for (const candidate of candidates) {
    if (memoryStore.has(candidate)) {
      return memoryStore.get(candidate)!;
    }
  }

  // Fallback to disk search across root and date directories
  try {
    if (!fs.existsSync(LOGS_DIR)) return null;
    const entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true });
    
    const dirsToScan: string[] = [LOGS_DIR];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirsToScan.push(path.join(LOGS_DIR, entry.name));
      }
    }

    for (const dir of dirsToScan) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const base = file.replace('.json', '').toUpperCase();
          for (const candidate of candidates) {
            if (base === candidate || base.includes(cleanId)) {
              const content = fs.readFileSync(path.join(dir, file), 'utf-8');
              const parsed: TaskLogMetadata = JSON.parse(content);
              memoryStore.set(parsed.requestId.toUpperCase(), parsed);
              return parsed;
            }
          }
        }
      }
    }
  } catch (err) {
    console.error(`[LogStore] Error reading logs from disk for ${cleanId}:`, err);
  }

  return null;
}
