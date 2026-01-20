#!/usr/bin/env node

import { getDb, getMetrics } from '../core/storage';

function main() {
  try {
    const db = getDb();
    const sessionId = db.prepare('SELECT id FROM sessions WHERE current = 1').get() as { id: string } | undefined;
    
    if (!sessionId) {
      console.log('No active session');
      return;
    }
    
    console.log('📊 Wink Metrics\n');
    
    // Today's development session stats
    const today = new Date().toISOString().split('T')[0];
    const todayStats = db.prepare(`
      SELECT 
        COUNT(CASE WHEN tool IN ('Write', 'Edit', 'MultiEdit') THEN 1 END) as edits,
        COUNT(CASE WHEN tool IN ('Read', 'View') THEN 1 END) as reads,
        COUNT(CASE WHEN tool = 'Stop' THEN 1 END) as stops
      FROM events
      WHERE session_id = ?
        AND datetime(timestamp/1000, 'unixepoch') >= ?
    `).get(sessionId.id, today) as { edits: number; reads: number; stops: number };
    
    console.log("Today's Development Session:");
    console.log(`  Files edited: ${todayStats.edits}`);
    console.log(`  Files read: ${todayStats.reads}`);
    console.log(`  Stop attempts: ${todayStats.stops}`);
    
    // Verification stats
    const verifyStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN all_passing = 1 THEN 1 ELSE 0 END) as passing,
        AVG(duration_ms) as avg_duration
      FROM verify_results
      WHERE session_id = ?
    `).get(sessionId.id) as { total: number; passing: number; avg_duration: number };
    
    if (verifyStats.total > 0) {
      console.log(`  Verification runs: ${verifyStats.total}`);
      console.log(`  Pass rate: ${Math.round((verifyStats.passing / verifyStats.total) * 100)}%`);
      console.log(`  Avg verify time: ${(verifyStats.avg_duration / 1000).toFixed(1)}s`);
    }
    
    // Weekly metrics
    console.log('\nThis Week\'s Wink Metrics:');
    const weekMetrics = getMetrics(7);
    
    if (weekMetrics.length === 0) {
      console.log('  (no data yet)');
    } else {
      let totalStopBlocks = 0;
      let totalStopAllows = 0;
      let totalEditBlocks = 0;
      let totalEditWarns = 0;
      let totalVerifyRuns = 0;
      let totalLoopDetections = 0;
      let totalSessionSaves = 0;
      
      for (const day of weekMetrics) {
        totalStopBlocks += day.stop_blocks || 0;
        totalStopAllows += day.stop_allows || 0;
        totalEditBlocks += day.edit_blocks || 0;
        totalEditWarns += day.edit_warns || 0;
        totalVerifyRuns += day.verify_runs || 0;
        totalLoopDetections += day.loop_detections || 0;
        totalSessionSaves += day.session_saves || 0;
      }
      
      console.log('\nStop Discipline:');
      console.log(`  Total stops attempted: ${totalStopBlocks + totalStopAllows}`);
      if (totalStopBlocks + totalStopAllows > 0) {
        console.log(`  Blocked (no verify): ${totalStopBlocks} (${Math.round((totalStopBlocks / (totalStopBlocks + totalStopAllows)) * 100)}%)`);
        console.log(`  Compliance rate: ${Math.round((totalStopAllows / (totalStopBlocks + totalStopAllows)) * 100)}%`);
      }
      
      console.log('\nEvidence Gates:');
      console.log(`  Total edit attempts: ${totalEditBlocks + totalEditWarns}`);
      if (totalEditBlocks > 0) {
        console.log(`  Blocked (no evidence): ${totalEditBlocks}`);
      }
      if (totalEditWarns > 0) {
        console.log(`  Warnings issued: ${totalEditWarns}`);
      }
      
      if (totalVerifyRuns > 0) {
        console.log(`\nVerification runs: ${totalVerifyRuns}`);
      }
      
      console.log('\nLoop Breaker:');
      console.log(`  Loop warnings issued: ${totalLoopDetections}`);
      
      console.log('\nSession Management:');
      console.log(`  Sessions auto-saved: ${totalSessionSaves}`);
    }
    
    // Most edited files
    const mostEdited = db.prepare(`
      SELECT 
        json_extract(input_json, '$.file_path') as file_path,
        COUNT(*) as edit_count
      FROM events
      WHERE tool IN ('Write', 'Edit', 'MultiEdit')
        AND session_id = ?
        AND json_extract(input_json, '$.file_path') IS NOT NULL
      GROUP BY file_path
      ORDER BY edit_count DESC
      LIMIT 5
    `).all(sessionId.id) as Array<{ file_path: string; edit_count: number }>;
    
    if (mostEdited.length > 0) {
      console.log('\nMost Edited Files:');
      for (const file of mostEdited) {
        console.log(`  ${file.file_path} (${file.edit_count} edits)`);
      }
    }
    
    // Recent decisions
    const recentDecisions = db.prepare(`
      SELECT decision_type, decision, reason, timestamp
      FROM decision_log
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT 5
    `).all(sessionId.id) as Array<{
      decision_type: string;
      decision: string;
      reason: string | null;
      timestamp: number;
    }>;
    
    if (recentDecisions.length > 0) {
      console.log('\nRecent Gate Decisions:');
      for (const d of recentDecisions) {
        const time = new Date(d.timestamp).toLocaleTimeString();
        const icon = d.decision === 'allow' ? '✅' : d.decision === 'warn' ? '⚠️' : '🛑';
        console.log(`  ${icon} ${time} - ${d.decision_type}: ${d.decision}`);
        if (d.reason) {
          console.log(`     Reason: ${d.reason}`);
        }
      }
    }
    
  } catch (error) {
    console.error('Error generating metrics:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}