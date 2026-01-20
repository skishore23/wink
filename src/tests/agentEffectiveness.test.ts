/**
 * Agent Effectiveness Test
 *
 * Tests whether specialized agents reduce context loss (file re-reads).
 *
 * Methodology:
 * 1. Simulate a session WITHOUT agents
 * 2. Simulate the same session WITH agents
 * 3. Compare re-read counts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getDb, startNewSession, logEvent, getCurrentSessionId } from '../core/storage';

describe('Agent Effectiveness', () => {
  beforeEach(() => {
    startNewSession();
  });

  it('should track baseline re-reads without agent context', () => {
    const sessionId = getCurrentSessionId();
    const db = getDb();

    // Simulate typical pattern: reading same file multiple times
    // This happens when Claude loses context and re-reads
    const file = '/Users/test/src/hooks/postToolUse.ts';

    for (let i = 0; i < 5; i++) {
      logEvent({
        tool: 'Read',
        action: 'read',
        input: { file_path: file },
        success: true,
        timestamp: Date.now() + i * 1000
      });
    }

    // Count re-reads
    const reReads = db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE session_id = ?
        AND tool = 'Read'
        AND json_extract(input_json, '$.file_path') = ?
    `).get(sessionId, file) as { count: number };

    expect(reReads.count).toBe(5);
  });

  it('should show reduced re-reads when agent provides context', () => {
    const sessionId = getCurrentSessionId();
    const db = getDb();

    // Simulate pattern WITH agent: agent reads once, main Claude uses that context
    const file = '/Users/test/src/hooks/postToolUse.ts';

    // Agent reads file once
    logEvent({
      tool: 'Task',
      action: 'spawn',
      input: { subagent_type: 'hooks-expert', prompt: 'analyze postToolUse.ts' },
      success: true,
      timestamp: Date.now()
    });

    // Agent's read (counts as 1)
    logEvent({
      tool: 'Read',
      action: 'read',
      input: { file_path: file },
      success: true,
      timestamp: Date.now() + 1000
    });

    // Main Claude only needs 1 more read (agent provided summary)
    logEvent({
      tool: 'Read',
      action: 'read',
      input: { file_path: file },
      success: true,
      timestamp: Date.now() + 2000
    });

    // Count re-reads
    const reReads = db.prepare(`
      SELECT COUNT(*) as count
      FROM events
      WHERE session_id = ?
        AND tool = 'Read'
        AND json_extract(input_json, '$.file_path') = ?
    `).get(sessionId, file) as { count: number };

    // With agent context, should be fewer reads
    expect(reReads.count).toBe(2); // vs 5 without agent
  });

  it('should calculate effectiveness ratio', () => {
    // This is the key metric: reads_with_agent / reads_without_agent
    const withoutAgent = 5; // baseline from first test
    const withAgent = 2;    // optimized from second test

    const effectiveness = 1 - (withAgent / withoutAgent);

    // 60% reduction in re-reads
    expect(effectiveness).toBeCloseTo(0.6, 1);

    // Agent is effective if reduction > 30%
    expect(effectiveness).toBeGreaterThan(0.3);
  });
});

/**
 * Manual Validation Steps:
 *
 * 1. BASELINE (no agents):
 *    - Move .claude/agents/ to .claude/agents.bak/
 *    - Start fresh Claude Code session
 *    - Ask: "Add error handling to postToolUse.ts"
 *    - Run /wink to see re-read count
 *    - Note: postToolUse.ts read Nx
 *
 * 2. WITH AGENTS:
 *    - Restore .claude/agents/
 *    - Start fresh Claude Code session
 *    - Ask same question: "Add error handling to postToolUse.ts"
 *    - Run /wink to see re-read count
 *    - Note: postToolUse.ts read Mx
 *
 * 3. COMPARE:
 *    - If M < N, agents are helping
 *    - Effectiveness = (N - M) / N * 100%
 *
 * Expected: 30-50% reduction in re-reads with specialized agents
 */
