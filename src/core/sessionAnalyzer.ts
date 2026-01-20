import { getDb, getCurrentSessionId, getQualityEvents, QualityEvent } from './storage';
import { ProjectDetector } from './projectDetector';
import * as path from 'path';

export interface HotFolder {
  path: string;
  editCount: number;
  readCount: number;
}

export interface CommonError {
  pattern: string;
  count: number;
  lastSeen: number;
  examples: string[];
}

export interface ToolUsage {
  tool: string;
  count: number;
  avgDuration: number;
}

export interface FileTypeStats {
  ext: string;
  editCount: number;
  readCount: number;
}

export interface LoopPattern {
  file: string;
  readCount: number;
  fileName: string;
}

export interface QualityHotspot {
  target: string;
  count: number;
  checks: string[];
}

export interface FailedCheckSummary {
  name: string;
  count: number;
  regressions: number;
  lastOutput?: string;
}

export interface SessionInsights {
  hotFolders: HotFolder[];
  commonErrors: CommonError[];
  toolFrequency: ToolUsage[];
  fileTypes: FileTypeStats[];
  loopPatterns: LoopPattern[];
  qualityHotspots: QualityHotspot[];
  failedChecks: FailedCheckSummary[];
  projectType: 'go' | 'node' | 'rust' | 'python' | 'unknown';
  totalEvents: number;
  totalEdits: number;
  totalReads: number;
  sessionDuration: number; // in minutes
}

export class SessionAnalyzer {
  private db: any;
  private sessionId: string;
  private allSessions: boolean;

  constructor(options: { allSessions?: boolean } = {}) {
    this.db = getDb();
    this.sessionId = getCurrentSessionId();
    this.allSessions = options.allSessions ?? false;
  }

  // Helper to get WHERE clause for session filtering
  private sessionFilter(alias?: string): string {
    if (this.allSessions) return '1=1';
    const col = alias ? `${alias}.session_id` : 'session_id';
    return `${col} = '${this.sessionId}'`;
  }

  analyze(): SessionInsights {
    return {
      hotFolders: this.getHotFolders(),
      commonErrors: this.getCommonErrors(),
      toolFrequency: this.getToolFrequency(),
      fileTypes: this.getFileTypes(),
      loopPatterns: this.getLoopPatterns(),
      qualityHotspots: this.getQualityHotspots(),
      failedChecks: this.getFailedChecks(),
      projectType: this.getProjectType(),
      ...this.getSessionStats()
    };
  }

  private getHotFolders(): HotFolder[] {
    // Get folder-level edit and read counts
    const sessionClause = this.allSessions ? '' : 'AND session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const results = this.db.prepare(`
      WITH file_ops AS (
        SELECT
          json_extract(input_json, '$.file_path') as file_path,
          tool,
          COUNT(*) as count
        FROM events
        WHERE tool IN ('Edit', 'Write', 'MultiEdit', 'Read', 'View')
          AND json_extract(input_json, '$.file_path') IS NOT NULL
          ${sessionClause}
        GROUP BY file_path, tool
      )
      SELECT
        file_path,
        SUM(CASE WHEN tool IN ('Edit', 'Write', 'MultiEdit') THEN count ELSE 0 END) as edit_count,
        SUM(CASE WHEN tool IN ('Read', 'View') THEN count ELSE 0 END) as read_count
      FROM file_ops
      GROUP BY file_path
      HAVING edit_count > 0 OR read_count > 0
    `).all(...params) as Array<{ file_path: string; edit_count: number; read_count: number }>;

    // Aggregate by folder
    const folderMap = new Map<string, { editCount: number; readCount: number }>();

    for (const row of results) {
      if (!row.file_path) continue;
      const folder = path.dirname(row.file_path);
      const existing = folderMap.get(folder) || { editCount: 0, readCount: 0 };
      existing.editCount += row.edit_count;
      existing.readCount += row.read_count;
      folderMap.set(folder, existing);
    }

    // Convert to array and sort by edit count
    return Array.from(folderMap.entries())
      .map(([folder, stats]) => ({
        path: folder,
        editCount: stats.editCount,
        readCount: stats.readCount
      }))
      .sort((a, b) => b.editCount - a.editCount)
      .slice(0, 10);
  }

  private getCommonErrors(): CommonError[] {
    // Look for failed events with error patterns in output
    const sessionClause = this.allSessions ? '' : 'AND session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const results = this.db.prepare(`
      SELECT
        output_summary,
        COUNT(*) as count,
        MAX(timestamp) as last_seen
      FROM events
      WHERE success = 0
        AND output_summary IS NOT NULL
        AND output_summary != ''
        ${sessionClause}
      GROUP BY output_summary
      ORDER BY count DESC
      LIMIT 20
    `).all(...params) as Array<{ output_summary: string; count: number; last_seen: number }>;

    // Group similar errors
    const errorMap = new Map<string, { count: number; lastSeen: number; examples: string[] }>();

    for (const row of results) {
      const pattern = this.extractErrorPattern(row.output_summary);
      const existing = errorMap.get(pattern) || { count: 0, lastSeen: 0, examples: [] };
      existing.count += row.count;
      existing.lastSeen = Math.max(existing.lastSeen, row.last_seen);
      if (existing.examples.length < 3) {
        existing.examples.push(row.output_summary.slice(0, 100));
      }
      errorMap.set(pattern, existing);
    }

    return Array.from(errorMap.entries())
      .map(([pattern, stats]) => ({
        pattern,
        count: stats.count,
        lastSeen: stats.lastSeen,
        examples: stats.examples
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private extractErrorPattern(output: string): string {
    // Extract common error patterns
    if (output.includes('type') && output.includes('not assignable')) {
      return 'TypeScript type mismatch';
    }
    if (output.includes('Cannot find')) {
      return 'Missing import/module';
    }
    if (output.includes('FAIL') || output.includes('fail')) {
      return 'Test failure';
    }
    if (output.includes('error TS')) {
      return 'TypeScript compilation error';
    }
    if (output.includes('go:') || output.includes('undefined:')) {
      return 'Go compilation error';
    }
    if (output.includes('lint') || output.includes('eslint')) {
      return 'Lint error';
    }
    // Generic pattern - first 30 chars
    return output.slice(0, 30).replace(/[^a-zA-Z ]/g, ' ').trim();
  }

  private getToolFrequency(): ToolUsage[] {
    const sessionClause = this.allSessions ? '1=1' : 'session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const results = this.db.prepare(`
      SELECT
        tool,
        COUNT(*) as count,
        AVG(duration_ms) as avg_duration
      FROM events
      WHERE ${sessionClause}
      GROUP BY tool
      ORDER BY count DESC
    `).all(...params) as Array<{ tool: string; count: number; avg_duration: number }>;

    return results.map(row => ({
      tool: row.tool,
      count: row.count,
      avgDuration: Math.round(row.avg_duration || 0)
    }));
  }

  private getFileTypes(): FileTypeStats[] {
    const sessionClause = this.allSessions ? '' : 'AND session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const results = this.db.prepare(`
      SELECT
        json_extract(input_json, '$.file_path') as file_path,
        tool
      FROM events
      WHERE tool IN ('Edit', 'Write', 'MultiEdit', 'Read', 'View')
        AND json_extract(input_json, '$.file_path') IS NOT NULL
        ${sessionClause}
    `).all(...params) as Array<{ file_path: string; tool: string }>;

    const extMap = new Map<string, { editCount: number; readCount: number }>();

    for (const row of results) {
      if (!row.file_path) continue;
      const ext = path.extname(row.file_path) || '(no ext)';
      const existing = extMap.get(ext) || { editCount: 0, readCount: 0 };

      if (['Edit', 'Write', 'MultiEdit'].includes(row.tool)) {
        existing.editCount++;
      } else {
        existing.readCount++;
      }
      extMap.set(ext, existing);
    }

    return Array.from(extMap.entries())
      .map(([ext, stats]) => ({
        ext,
        editCount: stats.editCount,
        readCount: stats.readCount
      }))
      .sort((a, b) => (b.editCount + b.readCount) - (a.editCount + a.readCount))
      .slice(0, 10);
  }

  private getLoopPatterns(): LoopPattern[] {
    const sessionClause = this.allSessions ? '' : 'AND session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const results = this.db.prepare(`
      SELECT
        json_extract(input_json, '$.file_path') as file_path,
        COUNT(*) as read_count
      FROM events
      WHERE tool IN ('Read', 'View')
        AND json_extract(input_json, '$.file_path') IS NOT NULL
        ${sessionClause}
      GROUP BY file_path
      HAVING read_count >= 3
      ORDER BY read_count DESC
      LIMIT 10
    `).all(...params) as Array<{ file_path: string; read_count: number }>;

    return results.map(row => ({
      file: row.file_path,
      readCount: row.read_count,
      fileName: path.basename(row.file_path)
    }));
  }

  private getQualityFailures(): QualityEvent[] {
    return getQualityEvents({
      onlyFailures: true,
      allSessions: this.allSessions
    });
  }

  private getQualityHotspots(): QualityHotspot[] {
    const failures = this.getQualityFailures();
    const hotspotMap = new Map<string, { count: number; checks: Set<string> }>();

    for (const failure of failures) {
      for (const filePath of failure.changedFiles) {
        const target = path.dirname(filePath);
        const existing = hotspotMap.get(target) || { count: 0, checks: new Set<string>() };
        existing.count += 1;
        existing.checks.add(failure.checkName);
        hotspotMap.set(target, existing);
      }
    }

    return Array.from(hotspotMap.entries())
      .map(([target, data]) => ({
        target,
        count: data.count,
        checks: Array.from(data.checks)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private getFailedChecks(): FailedCheckSummary[] {
    const failures = this.getQualityFailures();
    const checkMap = new Map<string, { count: number; regressions: number; lastOutput?: string }>();

    for (const failure of failures) {
      const existing = checkMap.get(failure.checkName) || {
        count: 0,
        regressions: 0,
        lastOutput: undefined
      };
      existing.count += 1;
      if (failure.isRegression) existing.regressions += 1;
      if (!existing.lastOutput && failure.outputSummary) {
        existing.lastOutput = failure.outputSummary;
      }
      checkMap.set(failure.checkName, existing);
    }

    return Array.from(checkMap.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        regressions: data.regressions,
        lastOutput: data.lastOutput
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private getProjectType(): 'go' | 'node' | 'rust' | 'python' | 'unknown' {
    const project = ProjectDetector.detect(process.cwd());
    const typeMap: Record<string, 'go' | 'node' | 'rust' | 'python' | 'unknown'> = {
      'go': 'go',
      'node': 'node',
      'rust': 'rust',
      'python': 'python',
      'unknown': 'unknown'
    };
    return typeMap[project.type] || 'unknown';
  }

  private getSessionStats(): { totalEvents: number; totalEdits: number; totalReads: number; sessionDuration: number } {
    const sessionClause = this.allSessions ? '1=1' : 'session_id = ?';
    const params = this.allSessions ? [] : [this.sessionId];

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total_events,
        SUM(CASE WHEN tool IN ('Edit', 'Write', 'MultiEdit') THEN 1 ELSE 0 END) as total_edits,
        SUM(CASE WHEN tool IN ('Read', 'View') THEN 1 ELSE 0 END) as total_reads,
        MIN(timestamp) as first_event,
        MAX(timestamp) as last_event
      FROM events
      WHERE ${sessionClause}
    `).get(...params) as {
      total_events: number;
      total_edits: number;
      total_reads: number;
      first_event: number;
      last_event: number;
    };

    const durationMs = (stats.last_event || 0) - (stats.first_event || 0);
    const durationMinutes = Math.round(durationMs / 60000);

    return {
      totalEvents: stats.total_events || 0,
      totalEdits: stats.total_edits || 0,
      totalReads: stats.total_reads || 0,
      sessionDuration: durationMinutes
    };
  }
}
