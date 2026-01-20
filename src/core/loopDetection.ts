import { getDb, getCurrentSessionId, updateMetric } from './storage';

export interface LoopWarning {
  type: 'repeated_read' | 'repeated_search';
  target: string;
  count: number;
  message: string;
}

export function detectLoops(windowSize: number = 10): LoopWarning | null {
  const db = getDb();
  const sessionId = getCurrentSessionId();
  
  // Get recent events
  const recentEvents = db.prepare(`
    SELECT tool, input_json, timestamp
    FROM events
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(sessionId, windowSize) as Array<{
    tool: string;
    input_json: string;
    timestamp: number;
  }>;
  
  // Count file reads
  const fileReadCounts = new Map<string, number>();
  const searchPatternCounts = new Map<string, number>();
  
  for (const event of recentEvents) {
    const input = JSON.parse(event.input_json);
    
    // Count file reads
    if (event.tool === 'Read' && input.file_path) {
      const count = fileReadCounts.get(input.file_path) || 0;
      fileReadCounts.set(input.file_path, count + 1);
    }
    
    // Count search patterns
    if (event.tool === 'Grep' && input.pattern) {
      const count = searchPatternCounts.get(input.pattern) || 0;
      searchPatternCounts.set(input.pattern, count + 1);
    }
  }
  
  // Check for repeated file reads (3x threshold)
  for (const [filePath, count] of fileReadCounts) {
    if (count >= 3) {
      updateMetric('loop_detections');
      return {
        type: 'repeated_read',
        target: filePath,
        count,
        message: `📍 Loop detected: You've read "${filePath}" ${count} times. You have the information - make the edit or move on.`
      };
    }
  }
  
  // Check for repeated searches (2x threshold)
  for (const [pattern, count] of searchPatternCounts) {
    if (count >= 2) {
      updateMetric('loop_detections');
      return {
        type: 'repeated_search',
        target: pattern,
        count,
        message: `📍 Loop detected: You've searched for "${pattern}" ${count} times. The results won't change - use what you found.`
      };
    }
  }
  
  return null;
}

// Track if we've already warned about a specific loop to avoid spam
const warnedLoops = new Map<string, number>();

export function shouldWarnAboutLoop(warning: LoopWarning): boolean {
  const key = `${warning.type}:${warning.target}`;
  const lastWarned = warnedLoops.get(key) || 0;
  const now = Date.now();
  
  // Don't warn about the same loop within 5 minutes
  if (now - lastWarned < 5 * 60 * 1000) {
    return false;
  }
  
  warnedLoops.set(key, now);
  return true;
}

export function clearLoopWarnings() {
  warnedLoops.clear();
}