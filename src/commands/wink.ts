#!/usr/bin/env node

/**
 * Wink Command
 *
 * Analyzes session data and outputs raw metrics for Claude to analyze.
 * Discipline-first: collects data, lets Claude reason about improvements.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SessionAnalyzer, SessionInsights } from '../core/sessionAnalyzer';
import { generateLearningReport } from '../core/learningEngine';
import { getThresholdSync, getThresholds } from '../core/thresholdManager';
import * as print from '../core/printer';

// ============================================================================
// Types
// ============================================================================

type ArtifactType = 'agent' | 'rule' | 'skill' | 'command' | 'hook';

interface ArtifactSuggestion {
  type: ArtifactType;
  name: string;
  metricEvidence: string;
  description: string;
  destination: string;
}

// ============================================================================
// Artifact checking
// ============================================================================

const checkArtifactExists = (type: ArtifactType, name: string): boolean => {
  const base = process.cwd();

  switch (type) {
    case 'agent':
      return fs.existsSync(path.join(base, '.claude', 'agents', `${name}.md`));
    case 'skill':
      return fs.existsSync(path.join(base, '.claude', 'skills', `${name}.md`)) ||
        fs.existsSync(path.join(base, '.claude', 'commands', `${name}.md`));
    case 'command':
      return fs.existsSync(path.join(base, '.claude', 'commands', `${name}.md`));
    case 'rule':
      return false; // Always suggest rules
    case 'hook':
      return fs.existsSync(path.join(base, 'hooks', 'hooks.json'));
    default:
      return false;
  }
};

// ============================================================================
// Suggestion generation
// ============================================================================

const findExistingAgents = (insights: SessionInsights): Array<{ name: string; folder: string; editCount: number }> => {
  const existing: Array<{ name: string; folder: string; editCount: number }> = [];
  const projectRoot = process.cwd();

  for (const folder of insights.hotFolders) {
    if (folder.path === projectRoot) continue;

    const folderName = folder.path.split('/').pop() || 'core';
    const agentName = `${folderName}-expert`;

    if (checkArtifactExists('agent', agentName)) {
      existing.push({ name: agentName, folder: folderName, editCount: folder.editCount });
    }
  }

  return existing;
};

const generateSuggestions = (insights: SessionInsights): ArtifactSuggestion[] => {
  const suggestions: ArtifactSuggestion[] = [];
  const threshold = getThresholdSync('folder-expert');
  const suggestedFolders = new Set<string>();
  const projectRoot = process.cwd();

  // Agent suggestions for hot folders
  for (const folder of insights.hotFolders.slice(0, 3)) {
    if (folder.editCount < threshold) continue;
    if (folder.path === projectRoot) continue;

    const folderName = folder.path.split('/').pop() || 'core';
    const agentName = `${folderName}-expert`;

    if (checkArtifactExists('agent', agentName)) continue;
    if (suggestedFolders.has(folderName)) continue;
    suggestedFolders.add(folderName);

    const relatedReads = insights.loopPatterns.filter(l =>
      l.file.includes(folder.path) || folder.path.includes(path.dirname(l.file))
    );
    const totalReads = relatedReads.reduce((a, b) => a + b.readCount, 0);

    let evidence = `${folder.editCount} edits in ${folderName}/`;
    if (totalReads > 0) {
      evidence += `, ${totalReads} re-reads`;
      const topFiles = relatedReads.slice(0, 2).map(r => r.fileName).join(', ');
      if (topFiles) evidence += ` (${topFiles})`;
    }

    suggestions.push({
      type: 'agent',
      name: agentName,
      metricEvidence: evidence,
      description: `Expert on ${folderName}/ folder patterns and code`,
      destination: `.claude/agents/${agentName}.md`,
    });
  }

  // Rule suggestions for recurring errors
  const significantErrors = insights.commonErrors.filter(e => e.count >= 3);
  if (significantErrors.length > 0) {
    const topError = significantErrors[0];
    suggestions.push({
      type: 'rule',
      name: 'error-prevention',
      metricEvidence: `${topError.count}x "${topError.pattern}" errors`,
      description: `Add rule to CLAUDE.md to prevent ${topError.pattern}`,
      destination: 'CLAUDE.md',
    });
  }

  return suggestions;
};

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode = args.includes('--apply');

  // Analyze all sessions
  const analyzer = new SessionAnalyzer({ allSessions: true });
  const insights = analyzer.analyze();

  // Print metrics
  print.printHeader();
  print.printSummary(insights.projectType, insights.totalEdits, insights.totalReads, insights.sessionDuration);
  print.printHotFolders(insights.hotFolders);
  print.printContextLoss(insights.loopPatterns);
  print.printErrors(insights.commonErrors);
  print.printCommandPatterns(insights.commandPatterns);
  print.printContextHygiene(insights.contextHygiene);

  // Generate and display suggestions
  const suggestions = generateSuggestions(insights);
  const existingAgents = findExistingAgents(insights);
  const newAgents = suggestions.filter(s => s.type === 'agent');
  const rules = suggestions.filter(s => s.type === 'rule');

  print.printAgentsHeader();

  if (existingAgents.length > 0) {
    print.printExistingAgents(existingAgents);
  }

  if (newAgents.length > 0) {
    print.printSuggestedAgents(newAgents.map(a => ({ name: a.name, evidence: a.metricEvidence })));
  }

  if (existingAgents.length === 0 && newAgents.length === 0) {
    print.printNoAgents();
  }

  if (rules.length > 0) {
    print.printRules(rules.map(r => ({ name: r.name, evidence: r.metricEvidence })));
  }

  // Handle --apply mode - show generation instructions for Claude
  if (applyMode) {
    if (newAgents.length === 0) {
      print.printNoAgentsToGenerate();
    } else {
      print.printGenerationHeader();

      for (const s of newAgents) {
        const folderName = s.name.replace('-expert', '');
        const folderPath = insights.hotFolders.find(f =>
          f.path.endsWith(folderName) || f.path.includes(`/${folderName}`)
        )?.path || `src/${folderName}`;

        const hotFiles = insights.loopPatterns
          .filter(l => l.file.includes(folderName))
          .slice(0, 5)
          .map(l => l.file);

        print.printAgentToGenerate({
          name: s.name,
          folder: folderPath,
          evidence: s.metricEvidence,
          hotFiles,
          destination: s.destination,
        });
      }

      print.printGenerationSteps();
    }
  } else if (newAgents.length > 0) {
    print.printApplyHint();
  }

  // Print current thresholds (static values for Claude to see)
  const thresholds = getThresholds();
  console.log('\ncurrent thresholds');
  for (const t of thresholds) {
    console.log(`  ${t.agentType}: ${t.thresholdValue}`);
  }

  // Print learning data
  const learningReport = generateLearningReport();
  print.printSimpleLearningReport(learningReport);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
