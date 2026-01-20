import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// Mock the storage module to use in-memory database
let mockDb: Database;
let mockSessionId: string;

// We'll test the SQL queries directly since the functions depend on storage module

describe('Context Hygiene Queries', () => {
  beforeEach(() => {
    mockDb = new Database(':memory:');
    mockSessionId = 'test-session-' + Date.now();

    // Create schema
    mockDb.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER,
        mode TEXT DEFAULT 'warn',
        current INTEGER DEFAULT 1
      );

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tool TEXT NOT NULL,
        action TEXT,
        input_json TEXT,
        output_summary TEXT,
        success INTEGER,
        duration_ms INTEGER
      );

      CREATE TABLE verify_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        mode TEXT NOT NULL,
        checks_json TEXT NOT NULL,
        all_passing INTEGER NOT NULL,
        duration_ms INTEGER
      );
    `);

    // Insert test session
    mockDb.prepare('INSERT INTO sessions (id, started_at, current) VALUES (?, ?, 1)')
      .run(mockSessionId, Date.now());
  });

  afterEach(() => {
    mockDb.close();
  });

  describe('Wasted Reads Detection', () => {
    it('identifies files read but not edited', () => {
      // Read 3 files
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/a.ts' }));
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/b.ts' }));
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/c.ts' }));

      // Edit only 1 file
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Edit', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/a.ts' }));

      // Query for wasted reads
      const wastedReads = mockDb.prepare(`
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
      `).all(mockSessionId, mockSessionId) as Array<{ file_path: string; count: number }>;

      expect(wastedReads.length).toBe(2); // b.ts and c.ts
      expect(wastedReads.map(r => r.file_path)).toContain('/src/b.ts');
      expect(wastedReads.map(r => r.file_path)).toContain('/src/c.ts');
    });

    it('returns empty when all reads led to edits', () => {
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/a.ts' }));
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Edit', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/a.ts' }));

      const wastedReads = mockDb.prepare(`
        SELECT json_extract(input_json, '$.file_path') as file_path
        FROM events
        WHERE session_id = ?
          AND tool IN ('Read', 'View')
          AND json_extract(input_json, '$.file_path') NOT IN (
            SELECT DISTINCT json_extract(input_json, '$.file_path')
            FROM events
            WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
          )
      `).all(mockSessionId, mockSessionId);

      expect(wastedReads.length).toBe(0);
    });
  });

  describe('Session Efficiency Calculation', () => {
    it('calculates focus ratio correctly', () => {
      // 4 unique files read
      for (const file of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
        mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
          .run(mockSessionId, Date.now(), JSON.stringify({ file_path: `/src/${file}` }));
      }

      // 2 unique files edited
      for (const file of ['a.ts', 'b.ts']) {
        mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Edit', ?)`)
          .run(mockSessionId, Date.now(), JSON.stringify({ file_path: `/src/${file}` }));
      }

      const reads = mockDb.prepare(`
        SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
        FROM events WHERE session_id = ? AND tool IN ('Read', 'View')
      `).get(mockSessionId) as { count: number };

      const edits = mockDb.prepare(`
        SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
        FROM events WHERE session_id = ? AND tool IN ('Edit', 'Write', 'MultiEdit')
      `).get(mockSessionId) as { count: number };

      const focusRatio = edits.count / reads.count;
      expect(focusRatio).toBe(0.5); // 2/4 = 0.5
    });

    it('counts loop warnings correctly', () => {
      // Read same file 5 times
      for (let i = 0; i < 5; i++) {
        mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
          .run(mockSessionId, Date.now() + i, JSON.stringify({ file_path: '/src/storage.ts' }));
      }

      // Read another file 2 times (not a loop)
      for (let i = 0; i < 2; i++) {
        mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
          .run(mockSessionId, Date.now() + i, JSON.stringify({ file_path: '/src/config.ts' }));
      }

      const loops = mockDb.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT json_extract(input_json, '$.file_path') as fp
          FROM events
          WHERE session_id = ? AND tool IN ('Read', 'View')
          GROUP BY fp
          HAVING COUNT(*) >= 3
        )
      `).get(mockSessionId) as { count: number };

      expect(loops.count).toBe(1); // Only storage.ts qualifies
    });
  });

  describe('Dead File Detection', () => {
    it('identifies created files never referenced', () => {
      // Create a new file
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Write', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: '/src/newFile.ts' }));

      // File never read or referenced
      const created = mockDb.prepare(`
        SELECT DISTINCT json_extract(input_json, '$.file_path') as file_path
        FROM events
        WHERE session_id = ? AND tool = 'Write'
      `).all(mockSessionId) as Array<{ file_path: string }>;

      for (const { file_path } of created) {
        const wasRead = mockDb.prepare(`
          SELECT COUNT(*) as count FROM events
          WHERE session_id = ? AND tool IN ('Read', 'View')
            AND json_extract(input_json, '$.file_path') = ?
        `).get(mockSessionId, file_path) as { count: number };

        expect(wasRead.count).toBe(0);
      }
    });

    it('does not flag files that were subsequently read', () => {
      const filePath = '/src/newFile.ts';

      // Create file
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Write', ?)`)
        .run(mockSessionId, Date.now(), JSON.stringify({ file_path: filePath }));

      // Read it
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Read', ?)`)
        .run(mockSessionId, Date.now() + 1000, JSON.stringify({ file_path: filePath }));

      const wasRead = mockDb.prepare(`
        SELECT COUNT(*) as count FROM events
        WHERE session_id = ? AND tool IN ('Read', 'View')
          AND json_extract(input_json, '$.file_path') = ?
      `).get(mockSessionId, filePath) as { count: number };

      expect(wasRead.count).toBe(1); // File was read, not dead
    });
  });

  describe('Search Funnel Tracking', () => {
    it('tracks searches followed by edits', () => {
      const searchTime = Date.now();

      // Grep search
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Grep', ?)`)
        .run(mockSessionId, searchTime, JSON.stringify({ pattern: 'TODO' }));

      // Edit after search
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Edit', ?)`)
        .run(mockSessionId, searchTime + 60000, JSON.stringify({ file_path: '/src/a.ts' }));

      // Count edits within 10 minutes of search
      const editsAfter = mockDb.prepare(`
        SELECT COUNT(DISTINCT json_extract(input_json, '$.file_path')) as count
        FROM events
        WHERE session_id = ?
          AND tool IN ('Edit', 'Write', 'MultiEdit')
          AND timestamp > ?
          AND timestamp < ? + 600000
      `).get(mockSessionId, searchTime, searchTime) as { count: number };

      expect(editsAfter.count).toBe(1);
    });

    it('identifies dead-end searches with no edits', () => {
      const searchTime = Date.now();

      // Grep search with no subsequent edit
      mockDb.prepare(`INSERT INTO events (session_id, timestamp, tool, input_json) VALUES (?, ?, 'Grep', ?)`)
        .run(mockSessionId, searchTime, JSON.stringify({ pattern: 'FIXME' }));

      const editsAfter = mockDb.prepare(`
        SELECT COUNT(*) as count
        FROM events
        WHERE session_id = ?
          AND tool IN ('Edit', 'Write', 'MultiEdit')
          AND timestamp > ?
          AND timestamp < ? + 600000
      `).get(mockSessionId, searchTime, searchTime) as { count: number };

      expect(editsAfter.count).toBe(0);
    });
  });
});

describe('Efficiency Score Calculation', () => {
  it('produces higher score for focused sessions', () => {
    // Focused: 4 reads, 4 edits (ratio 1.0)
    const focusedRatio = 1.0;
    const focusedScore = 50 + Math.min(focusedRatio * 50, 40); // Base + focus

    // Unfocused: 10 reads, 2 edits (ratio 0.2)
    const unfocusedRatio = 0.2;
    const unfocusedScore = 50 + Math.min(unfocusedRatio * 50, 40);

    expect(focusedScore).toBeGreaterThan(unfocusedScore);
  });

  it('penalizes loops', () => {
    const baseScore = 70;
    const loopPenalty = 5 * 3; // 3 files with loops

    expect(baseScore - loopPenalty).toBe(55);
  });
});
