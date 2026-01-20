#!/usr/bin/env node

/**
 * Wink Command
 * 
 * Analyzes session data and suggests specialized agents.
 * Uses hybrid approach: hooks collect metrics, Claude generates rich content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SessionAnalyzer, SessionInsights } from '../core/sessionAnalyzer';
import { runLearningCycle } from '../core/learningEngine';
import { adjustThresholdsForEfficiency } from '../core/thresholdManager';
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

interface Suggestion {
  date: string;
  type: ArtifactType;
  name: string;
  reason: string;
  created: boolean;
  outcome?: string;
}

interface WinkLearnings {
  suggestions: Suggestion[];
  patterns: {
    hotFolderThreshold: number;
    contextLossThreshold: number;
    effectiveAgents: string[];
    ineffectivePatterns: string[];
  };
  insights: string[];
}

const DEFAULT_LEARNINGS: WinkLearnings = {
  suggestions: [],
  patterns: {
    hotFolderThreshold: 20,
    contextLossThreshold: 8,
    effectiveAgents: [],
    ineffectivePatterns: []
  },
  insights: []
};

// ============================================================================
// Persistence
// ============================================================================

const getLearningsPath = (): string => 
  path.join(process.cwd(), '.wink', 'learnings.json');

const loadLearnings = (): WinkLearnings => {
  try {
    const filePath = getLearningsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Return default on error
  }
  return { ...DEFAULT_LEARNINGS };
};

const saveLearnings = (learnings: WinkLearnings): void => {
  try {
    const filePath = getLearningsPath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(learnings, null, 2));
  } catch {
    // Silently fail
  }
};

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
// Analysis
// ============================================================================

const analyzeOutcomes = (learnings: WinkLearnings, insights: SessionInsights): string[] => {
  const newInsights: string[] = [];

  for (const suggestion of learnings.suggestions) {
    if (suggestion.type === 'agent' && !suggestion.outcome) {
      const exists = checkArtifactExists('agent', suggestion.name);

      if (exists) {
        suggestion.created = true;
        const relatedReads = insights.loopPatterns.filter(l =>
          suggestion.name.includes(l.fileName.replace('.ts', '').split('/').pop() || '')
        );

        if (relatedReads.length === 0 || relatedReads.every(r => r.readCount < 5)) {
          suggestion.outcome = 'helped reduce re-reads';
          if (!learnings.patterns.effectiveAgents.includes(suggestion.name)) {
            learnings.patterns.effectiveAgents.push(suggestion.name);
          }
          newInsights.push(`${suggestion.name} agent reduced context loss`);
        }
      }
    }
  }

  if (learnings.suggestions.length >= 3) {
    const created = learnings.suggestions.filter(s => s.created).length;
    const adoptionRate = created / learnings.suggestions.length;

    if (adoptionRate < 0.3 && !learnings.insights.includes('suggestions often ignored')) {
      newInsights.push('suggestions often ignored - may need higher thresholds');
      learnings.patterns.hotFolderThreshold = Math.min(50, learnings.patterns.hotFolderThreshold + 10);
    }
  }

  return newInsights;
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

const generateSuggestions = (insights: SessionInsights, learnings: WinkLearnings): ArtifactSuggestion[] => {
  const suggestions: ArtifactSuggestion[] = [];
  const threshold = learnings.patterns.hotFolderThreshold;
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
  const learnings = loadLearnings();

  // Analyze outcomes
  const newInsights = analyzeOutcomes(learnings, insights);
  if (newInsights.length > 0) {
    learnings.insights.push(...newInsights);
  }

  // Print metrics
  print.printHeader();
  print.printSummary(insights.projectType, insights.totalEdits, insights.totalReads, insights.sessionDuration);
  print.printHotFolders(insights.hotFolders);
  print.printContextLoss(insights.loopPatterns);
  print.printErrors(insights.commonErrors);
  print.printContextHygiene(insights.contextHygiene);

  // Adjust thresholds based on efficiency (self-improving)
  const efficiencyAdjustments = adjustThresholdsForEfficiency(insights.contextHygiene.efficiency.score);

  // Generate and display suggestions
  const suggestions = generateSuggestions(insights, learnings);
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

  // Handle --apply mode
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

  // Print learnings
  print.printLearnings({
    effectiveAgents: learnings.patterns.effectiveAgents,
    insights: learnings.insights,
  });

  print.printThresholds(learnings.patterns.hotFolderThreshold, learnings.patterns.contextLossThreshold);

  // Run and display learning report
  const learningReport = runLearningCycle(30);

  // Merge efficiency-based adjustments into report
  if (efficiencyAdjustments.length > 0) {
    learningReport.thresholdAdjustments.push(...efficiencyAdjustments);
    learningReport.insights.push(
      `Adjusted ${efficiencyAdjustments.length} threshold(s) based on efficiency score (${insights.contextHygiene.efficiency.score}/100)`
    );
  }

  print.printLearningReport(learningReport);

  // Record suggestions
  const today = new Date().toISOString().split('T')[0];
  for (const s of suggestions) {
    const existing = learnings.suggestions.find(ls => ls.name === s.name && ls.date === today);
    if (!existing) {
      learnings.suggestions.push({
        date: today,
        type: s.type,
        name: s.name,
        reason: s.metricEvidence,
        created: checkArtifactExists(s.type, s.name)
      });
    }
  }

  // Keep only last 20 suggestions
  if (learnings.suggestions.length > 20) {
    learnings.suggestions = learnings.suggestions.slice(-20);
  }

  saveLearnings(learnings);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
