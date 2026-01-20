import { getDb, getCurrentSessionId } from './storage';
import * as path from 'path';

export interface WastedRead {
  file: string;
  count: number;
}

export interface SessionEfficiency {
  uniqueFilesRead: number;
  uniqueFilesEdited: number;
  focusRatio: number;
  loopCount: number;
  searchEfficiency: number;
  verificationFailures: number;
  score: number;
}

export interface SearchFunnel {
  pattern: string;
  filesMatched: number;
  filesRead: number;
  filesEdited: number;
  effectiveness: number;
}

export interface ContextHygieneReport {
  wastedReads: WastedRead[];
  deadFiles: string[];
  efficiency: SessionEfficiency;
  searchFunnels: SearchFunnel[];
}

export function getWastedReads(sessionId?: string): WastedRead[] {
  const db = getDb();
  const sid = sessionId || getCurrentSessionId();

  const result = db.prepare(`
    SELECT json_extract(input_json, '$.file_path') as file_path, COUNT(*) as count
    FROM events
    WHERE session_id = ?
      AND tool IN ('Read', 'View')
      AND json_extract(input_json, '$.file_path') IS NOT NULL
      AND json_extract(input_json, '$.file_path') NOT IN (
        SELECT DISTINCT json_extract(input_json, '$.file_path')
        FROM events
        WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
          AND json_extract(input_json, '$.file_path') IS NOT NULL
      )
    GROUP BY file_path
    ORDER BY count DESC
  `).all(sid, sid) as Array<{ file_path: string; count: number }>;

  return result.map(r => ({
    file: path.basename(r.file_path),
    count: r.count
  }));
}

export function getDeadFiles(sessionId?: string): string[] {
  const db = getDb();
  const sid = sessionId || getCurrentSessionId();

  // Files created via Write that were never subsequently Read or referenced in Edit
  const created = db.prepare(`
    SELECT DISTINCT json_extract(input_json, '$.file_path') as file_path
    FROM events
    WHERE session_id = ?
      AND tool = 'Write'
      AND json_extract(input_json, '$.file_path') IS NOT NULL
  `).all(sid) as Array<{ file_path: string }>;

  const deadFiles: string[] = [];

  for (const { file_path } of created) {
    // Check if this file was ever Read after creation
    const wasRead = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE session_id = ?
        AND tool IN ('Read', 'View')
        AND json_extract(input_json, '$.file_path') = ?
    `).get(sid, file_path) as { count: number };

    // Check if this file appears in any Grep results (simplified - check if mentioned)
    const wasReferenced = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE session_id = ?
        AND tool IN ('Edit', 'Grep')
        AND (
          json_extract(input_json, '$.file_path') = ?
          OR output_summary LIKE ?
        )
    `).get(sid, file_path, `%${path.basename(file_path)}%`) as { count: number };

    if (wasRead.count === 0 && wasReferenced.count === 0) {
      deadFiles.push(path.basename(file_path));
    }
  }

  return deadFiles;
}

export function calculateEfficiency(sessionId?: string): SessionEfficiency {
  const db = getDb();
  const sid = sessionId || getCurrentSessionId();

  // Unique files read
  const reads = db.prepare(`
    SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
    FROM events
    WHERE session_id = ? AND tool IN ('Read', 'View')
      AND json_extract(input_json, '$.file_path') IS NOT NULL
  `).get(sid) as { count: number };

  // Unique files edited
  const edits = db.prepare(`
    SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
    FROM events
    WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
      AND json_extract(input_json, '$.file_path') IS NOT NULL
  `).get(sid) as { count: number };

  // Loop count (files read 3+ times)
  const loops = db.prepare(`
    SELECT COUNT(*) as count FROM (
      SELECT json_extract(input_json, '$.file_path') as fp
      FROM events
      WHERE session_id = ? AND tool IN ('Read', 'View')
        AND json_extract(input_json, '$.file_path') IS NOT NULL
      GROUP BY fp
      HAVING COUNT(*) >= 3
    )
  `).get(sid) as { count: number };

  // Search efficiency: searches that led to edits
  const totalSearches = db.prepare(`
    SELECT COUNT(*) as count FROM events
    WHERE session_id = ? AND tool = 'Grep'
  `).get(sid) as { count: number };

  // Simplified: searches where pattern appears in edited file names
  const effectiveSearches = db.prepare(`
    SELECT COUNT(DISTINCT e1.id) as count
    FROM events e1
    WHERE e1.session_id = ? AND e1.tool = 'Grep'
      AND EXISTS (
        SELECT 1 FROM events e2
        WHERE e2.session_id = ?
          AND e2.tool IN ('Edit', 'Write', 'MultiEdit')
          AND e2.timestamp > e1.timestamp
      )
  `).get(sid, sid) as { count: number };

  // Verification failures
  const verifyFails = db.prepare(`
    SELECT COUNT(*) as count FROM verify_results
    WHERE session_id = ? AND all_passing = 0
  `).get(sid) as { count: number };

  const uniqueFilesRead = reads.count;
  const uniqueFilesEdited = edits.count;
  const focusRatio = uniqueFilesRead > 0 ? uniqueFilesEdited / uniqueFilesRead : 1;
  const loopCount = loops.count;
  const searchEfficiency = totalSearches.count > 0
    ? effectiveSearches.count / totalSearches.count
    : 1;
  const verificationFailures = verifyFails.count;

  // Composite score (0-100)
  // Higher focus ratio = better, fewer loops = better, higher search efficiency = better
  const focusScore = Math.min(focusRatio * 50, 40); // max 40 points
  const loopPenalty = Math.min(loopCount * 5, 20);   // max -20 points
  const searchScore = searchEfficiency * 30;         // max 30 points
  const verifyPenalty = Math.min(verificationFailures * 5, 10); // max -10 points

  const score = Math.max(0, Math.min(100,
    50 + focusScore - loopPenalty + searchScore - verifyPenalty
  ));

  return {
    uniqueFilesRead,
    uniqueFilesEdited,
    focusRatio: Math.round(focusRatio * 100) / 100,
    loopCount,
    searchEfficiency: Math.round(searchEfficiency * 100) / 100,
    verificationFailures,
    score: Math.round(score)
  };
}

export function getSearchFunnels(sessionId?: string): SearchFunnel[] {
  const db = getDb();
  const sid = sessionId || getCurrentSessionId();

  // Get all grep searches
  const searches = db.prepare(`
    SELECT id, json_extract(input_json, '$.pattern') as pattern, timestamp
    FROM events
    WHERE session_id = ? AND tool = 'Grep'
    ORDER BY timestamp DESC
    LIMIT 10
  `).all(sid) as Array<{ id: number; pattern: string; timestamp: number }>;

  return searches.map(search => {
    // Count files read after this search
    const readsAfter = db.prepare(`
      SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
      FROM events
      WHERE session_id = ?
        AND tool IN ('Read', 'View')
        AND timestamp > ?
        AND timestamp < ? + 300000
    `).get(sid, search.timestamp, search.timestamp) as { count: number };

    // Count files edited after this search
    const editsAfter = db.prepare(`
      SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
      FROM events
      WHERE session_id = ?
        AND tool IN ('Edit', 'Write', 'MultiEdit')
        AND timestamp > ?
        AND timestamp < ? + 600000
    `).get(sid, search.timestamp, search.timestamp) as { count: number };

    return {
      pattern: search.pattern?.slice(0, 30) || '?',
      filesMatched: 0, // Would need to parse grep output
      filesRead: readsAfter.count,
      filesEdited: editsAfter.count,
      effectiveness: editsAfter.count > 0 ? 1 : 0
    };
  });
}

export function analyzeContextHygiene(sessionId?: string): ContextHygieneReport {
  const sid = sessionId || getCurrentSessionId();

  return {
    wastedReads: getWastedReads(sid),
    deadFiles: getDeadFiles(sid),
    efficiency: calculateEfficiency(sid),
    searchFunnels: getSearchFunnels(sid)
  };
}

export function formatHygieneWarning(report: ContextHygieneReport): string | null {
  const warnings: string[] = [];

  // Warn if many wasted reads
  if (report.wastedReads.length >= 3) {
    const files = report.wastedReads.slice(0, 3).map(r => r.file).join(', ');
    warnings.push(`${report.wastedReads.length} files read but unused (${files})`);
  }

  // Warn if dead files
  if (report.deadFiles.length > 0) {
    warnings.push(`${report.deadFiles.length} new file${report.deadFiles.length > 1 ? 's' : ''} not imported`);
  }

  // Warn if low efficiency
  if (report.efficiency.score < 50) {
    warnings.push(`efficiency: ${report.efficiency.score}/100`);
  }

  if (warnings.length === 0) return null;

  return `○ wink · ${warnings.join(' · ')}`;
}

export function formatSessionSummary(report: ContextHygieneReport): string {
  const lines = [
    `○ wink · session summary`,
    `  Efficiency: ${report.efficiency.score}/100`,
    `  Focus: ${report.efficiency.focusRatio} (${report.efficiency.uniqueFilesRead} read → ${report.efficiency.uniqueFilesEdited} edited)`
  ];

  if (report.efficiency.loopCount > 0) {
    lines.push(`  Loops: ${report.efficiency.loopCount} file${report.efficiency.loopCount > 1 ? 's' : ''} re-read 3+ times`);
  }

  if (report.wastedReads.length > 0) {
    lines.push(`  Context waste: ${report.wastedReads.length} files read but unused`);
  }

  if (report.deadFiles.length > 0) {
    lines.push(`  Dead files: ${report.deadFiles.join(', ')}`);
  }

  return lines.join('\n');
}
