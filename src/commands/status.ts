#!/usr/bin/env node

import { getDb, getCurrentSessionId, getSessionConfig } from '../core/storage';
import { analyzeContextHygiene } from '../core/contextHygiene';

function main() {
  try {
    const db = getDb();
    const sessionId = getCurrentSessionId();
    const config = getSessionConfig();
    
    console.log('🔍 Wink Status\n');
    console.log(`Session: ${sessionId}`);
    console.log(`Mode: ${config.mode}\n`);
    
    // Recent events
    const recentEvents = db.prepare(`
      SELECT tool, action, timestamp, success
      FROM events
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `).all(sessionId) as Array<{
      tool: string;
      action: string | null;
      timestamp: number;
      success: number;
    }>;
    
    console.log('📋 Recent Events:');
    if (recentEvents.length === 0) {
      console.log('  (no events yet)');
    } else {
      for (const event of recentEvents) {
        const time = new Date(event.timestamp).toLocaleTimeString();
        const status = event.success ? '✓' : '✗';
        const action = event.action ? ` (${event.action})` : '';
        console.log(`  ${status} ${time} - ${event.tool}${action}`);
      }
    }
    
    console.log('\n📁 Evidence Collected:');
    
    // Files with evidence (successful reads)
    const successfulEvidence = db.prepare(`
      SELECT file_path, evidence_type, detail_json, MAX(timestamp) as last_seen
      FROM evidence
      WHERE session_id = ? AND json_extract(detail_json, '$.success') != 0
      GROUP BY file_path, evidence_type
      ORDER BY last_seen DESC
      LIMIT 20
    `).all(sessionId) as Array<{
      file_path: string;
      evidence_type: string;
      detail_json: string;
      last_seen: number;
    }>;
    
    if (successfulEvidence.length === 0) {
      console.log('  (no evidence yet)');
    } else {
      // Group by file
      const fileEvidence = new Map<string, Set<string>>();
      for (const ev of successfulEvidence) {
        if (!fileEvidence.has(ev.file_path)) {
          fileEvidence.set(ev.file_path, new Set());
        }
        fileEvidence.get(ev.file_path)!.add(ev.evidence_type);
      }
      
      for (const [file, types] of fileEvidence) {
        const badges = [];
        if (types.has('file_read')) badges.push('READ');
        if (types.has('grep_hit')) badges.push('GREP');
        console.log(`  ${file} [${badges.join(', ')}]`);
      }
    }
    
    // Failed navigation attempts
    const failedAttempts = db.prepare(`
      SELECT file_path, COUNT(*) as attempts, MAX(timestamp) as last_attempt
      FROM evidence
      WHERE session_id = ? AND json_extract(detail_json, '$.success') = 0
      GROUP BY file_path
      ORDER BY last_attempt DESC
      LIMIT 5
    `).all(sessionId) as Array<{
      file_path: string;
      attempts: number;
      last_attempt: number;
    }>;
    
    if (failedAttempts.length > 0) {
      console.log('\n🧭 Navigation Attempts (failed reads):');
      for (const attempt of failedAttempts) {
        const fileName = attempt.file_path.split('/').pop() || attempt.file_path;
        console.log(`  ❌ ${fileName} (${attempt.attempts} attempt${attempt.attempts > 1 ? 's' : ''})`);
      }
    }
    
    // Summary stats
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_events,
        SUM(CASE WHEN tool IN ('Write', 'Edit', 'MultiEdit') THEN 1 ELSE 0 END) as edit_count,
        SUM(CASE WHEN tool IN ('Read', 'View') THEN 1 ELSE 0 END) as read_count
      FROM events
      WHERE session_id = ?
    `).get(sessionId) as {
      total_events: number;
      edit_count: number;
      read_count: number;
    };
    
    console.log('\n📊 Session Stats:');
    console.log(`  Total events: ${stats.total_events}`);
    console.log(`  Files read: ${stats.read_count}`);
    console.log(`  Edits made: ${stats.edit_count}`);

    // Context hygiene
    const hygiene = analyzeContextHygiene(sessionId);
    console.log('\n🧹 Context Hygiene:');
    console.log(`  Efficiency: ${hygiene.efficiency.score}/100`);
    console.log(`  Focus ratio: ${hygiene.efficiency.focusRatio} (${hygiene.efficiency.uniqueFilesRead} read → ${hygiene.efficiency.uniqueFilesEdited} edited)`);

    if (hygiene.efficiency.loopCount > 0) {
      console.log(`  Loop warnings: ${hygiene.efficiency.loopCount} file${hygiene.efficiency.loopCount > 1 ? 's' : ''} read 3+ times`);
    }

    if (hygiene.wastedReads.length > 0) {
      const files = hygiene.wastedReads.slice(0, 3).map(r => r.file).join(', ');
      console.log(`  Context waste: ${hygiene.wastedReads.length} files read but unused (${files})`);
    }

    if (hygiene.deadFiles.length > 0) {
      console.log(`  Dead files: ${hygiene.deadFiles.join(', ')}`);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}