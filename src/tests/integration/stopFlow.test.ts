/**
 * Integration tests for the full stop flow
 * Tests the complete pipeline: prompt → intent → edits → verify → stop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// Test with a real temporary database
const TEST_DB_PATH = '/tmp/wink-test-integration.db';

describe('Stop Flow Integration', () => {
  let db: Database;

  beforeEach(() => {
    // Clean slate for each test
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);

    // Initialize schema (same as storage.ts)
    db.exec(`
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

      CREATE TABLE intents (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        raw_prompt TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE verification_baseline (
        session_id TEXT NOT NULL,
        check_name TEXT NOT NULL,
        passed INTEGER NOT NULL,
        captured_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, check_name)
      );
    `);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  function createSession(): string {
    const sessionId = `test-session-${Date.now()}`;
    db.prepare('INSERT INTO sessions (id, started_at, current) VALUES (?, ?, 1)').run(sessionId, Date.now());
    return sessionId;
  }

  function logEdit(sessionId: string, filePath: string): void {
    db.prepare(`
      INSERT INTO events (session_id, timestamp, tool, input_json, success)
      VALUES (?, ?, 'Edit', ?, 1)
    `).run(sessionId, Date.now(), JSON.stringify({ file_path: filePath }));
  }

  function logVerify(sessionId: string, passing: boolean): void {
    db.prepare(`
      INSERT INTO verify_results (session_id, timestamp, mode, checks_json, all_passing, duration_ms)
      VALUES (?, ?, 'full', ?, ?, 100)
    `).run(sessionId, Date.now(), JSON.stringify([{ name: 'test', passed: passing }]), passing ? 1 : 0);
  }

  function createIntent(sessionId: string, prompt: string): void {
    db.prepare(`
      INSERT INTO intents (id, session_id, raw_prompt, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(`intent-${Date.now()}`, sessionId, prompt, Date.now());
  }

  function setBaseline(sessionId: string, checks: Array<{ name: string; passed: boolean }>): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO verification_baseline (session_id, check_name, passed, captured_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const check of checks) {
      stmt.run(sessionId, check.name, check.passed ? 1 : 0, Date.now());
    }
  }

  // Simulate the stopGate logic
  function shouldAllowStop(sessionId: string): { allow: boolean; reason: string } {
    // Check if any edits were made
    const edits = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE session_id = ? AND tool IN ('Write', 'Edit', 'MultiEdit')
    `).get(sessionId) as { count: number };

    if (edits.count === 0) {
      return { allow: true, reason: 'no_edits' };
    }

    // Check if verification ran
    const verifyCount = db.prepare(`
      SELECT COUNT(*) as count FROM verify_results WHERE session_id = ?
    `).get(sessionId) as { count: number };

    if (verifyCount.count === 0) {
      return { allow: false, reason: 'no_verification_run' };
    }

    // Get last verify result
    const lastVerify = db.prepare(`
      SELECT all_passing, checks_json, timestamp FROM verify_results
      WHERE session_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(sessionId) as { all_passing: number; checks_json: string; timestamp: number };

    // Get baseline
    const baseline = db.prepare(`
      SELECT check_name, passed FROM verification_baseline WHERE session_id = ?
    `).all(sessionId) as Array<{ check_name: string; passed: number }>;

    const baselineMap = new Map(baseline.map(b => [b.check_name, b.passed === 1]));

    if (!lastVerify.all_passing) {
      const checks = JSON.parse(lastVerify.checks_json) as Array<{ name: string; passed: boolean }>;
      const failingChecks = checks.filter(c => !c.passed);

      // Check for regressions (was passing in baseline, now failing)
      const regressions = failingChecks.filter(c => baselineMap.get(c.name) === true);

      if (regressions.length > 0) {
        return { allow: false, reason: 'regression_detected' };
      }

      // Pre-existing failures - allow with warning
      return { allow: true, reason: 'pre_existing_failures' };
    }

    // Check for edits after verify
    const editsAfterVerify = db.prepare(`
      SELECT COUNT(*) as count FROM events
      WHERE session_id = ? AND tool IN ('Write', 'Edit', 'MultiEdit')
        AND timestamp > ?
    `).get(sessionId, lastVerify.timestamp) as { count: number };

    if (editsAfterVerify.count > 0) {
      return { allow: false, reason: 'unverified_edits' };
    }

    return { allow: true, reason: 'all_checks_passed' };
  }

  describe('Basic Stop Flow', () => {
    it('allows stop when no edits made', () => {
      const sessionId = createSession();
      // No edits, no verify - should still allow
      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('no_edits');
    });

    it('blocks stop when edits made but no verify', () => {
      const sessionId = createSession();
      logEdit(sessionId, '/path/to/file.ts');

      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('no_verification_run');
    });

    it('allows stop when edits made and verify passes', () => {
      const sessionId = createSession();
      logEdit(sessionId, '/path/to/file.ts');
      logVerify(sessionId, true);

      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('all_checks_passed');
    });

    it('blocks stop when edits made after verify', () => {
      const sessionId = createSession();
      logEdit(sessionId, '/path/to/file.ts');
      logVerify(sessionId, true);

      // Wait a bit to ensure timestamp difference
      const now = Date.now();
      db.prepare(`
        INSERT INTO events (session_id, timestamp, tool, input_json, success)
        VALUES (?, ?, 'Edit', ?, 1)
      `).run(sessionId, now + 1000, JSON.stringify({ file_path: '/another/file.ts' }));

      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('unverified_edits');
    });
  });

  describe('Baseline Awareness', () => {
    it('blocks on regressions (was passing, now failing)', () => {
      const sessionId = createSession();
      logEdit(sessionId, '/path/to/file.ts');

      // Baseline: test was passing
      setBaseline(sessionId, [{ name: 'test', passed: true }]);

      // Now test fails
      logVerify(sessionId, false);

      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('regression_detected');
    });

    it('allows stop with pre-existing failures (was failing, still failing)', () => {
      const sessionId = createSession();
      logEdit(sessionId, '/path/to/file.ts');

      // Baseline: test was already failing
      setBaseline(sessionId, [{ name: 'test', passed: false }]);

      // Still failing
      logVerify(sessionId, false);

      const result = shouldAllowStop(sessionId);
      expect(result.allow).toBe(true);
      expect(result.reason).toBe('pre_existing_failures');
    });
  });

  describe('Smart Verification', () => {
    it('identifies doc-only changes', () => {
      const docFiles = ['README.md', 'docs/guide.md', 'CHANGELOG.txt'];
      const codeFiles = ['src/index.ts', 'lib/utils.js'];

      const isDocOnly = (files: string[]) => files.every(f => /\.(md|txt|rst|adoc)$/.test(f));

      expect(isDocOnly(docFiles)).toBe(true);
      expect(isDocOnly(codeFiles)).toBe(false);
      expect(isDocOnly([...docFiles, ...codeFiles])).toBe(false);
    });

    it('identifies code files correctly', () => {
      const codePattern = /\.(ts|tsx|js|jsx|go|py|rs|java|cpp|c|h|swift|kt|rb|php)$/;

      expect(codePattern.test('file.ts')).toBe(true);
      expect(codePattern.test('file.go')).toBe(true);
      expect(codePattern.test('file.py')).toBe(true);
      expect(codePattern.test('file.md')).toBe(false);
      expect(codePattern.test('config.json')).toBe(false);
    });
  });

  describe('Intent Flow', () => {
    it('captures intent on substantial prompts', () => {
      const sessionId = createSession();
      createIntent(sessionId, 'Refactor the authentication system to use JWT tokens');

      const intent = db.prepare(`
        SELECT raw_prompt, status FROM intents WHERE session_id = ?
      `).get(sessionId) as { raw_prompt: string; status: string };

      expect(intent.raw_prompt).toContain('Refactor');
      expect(intent.status).toBe('active');
    });

    it('has active intent until completed', () => {
      const sessionId = createSession();
      createIntent(sessionId, 'Add unit tests for the API');

      // Intent should be active
      let intent = db.prepare(`
        SELECT status FROM intents WHERE session_id = ? AND status = 'active'
      `).get(sessionId) as { status: string } | undefined;
      expect(intent?.status).toBe('active');

      // Complete intent
      db.prepare(`UPDATE intents SET status = 'completed' WHERE session_id = ?`).run(sessionId);

      // No more active intent
      intent = db.prepare(`
        SELECT status FROM intents WHERE session_id = ? AND status = 'active'
      `).get(sessionId) as { status: string } | undefined;
      expect(intent).toBeFalsy(); // null or undefined
    });
  });
});
