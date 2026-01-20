#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { SessionAnalyzer, SessionInsights } from '../core/sessionAnalyzer';
import { runLearningCycle, formatLearningReport } from '../core/learningEngine';

// Minimal colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

// Artifact types that can be generated
type ArtifactType = 'agent' | 'rule' | 'skill' | 'command' | 'hook';

interface ArtifactSuggestion {
  type: ArtifactType;
  name: string;
  metricEvidence: string;  // REQUIRED - specific data that justifies this
  description: string;
  destination: string;     // Where to write it
  content?: string;        // Optional pre-generated content
}

// Learning types
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
    hotFolderThreshold: number;      // edits needed to suggest agent
    contextLossThreshold: number;    // reads needed to flag context loss
    effectiveAgents: string[];       // agents that reduced re-reads
    ineffectivePatterns: string[];   // patterns that didn't help
  };
  insights: string[];                // accumulated learnings
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

function getLearningsPath(): string {
  return path.join(process.cwd(), '.wink', 'learnings.json');
}

function loadLearnings(): WinkLearnings {
  try {
    const filePath = getLearningsPath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Return default on error
  }
  return { ...DEFAULT_LEARNINGS };
}

function saveLearnings(learnings: WinkLearnings): void {
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
}

function checkArtifactExists(type: ArtifactType, name: string): boolean {
  // For agents/skills/commands - check if the specific file exists
  if (type === 'agent') {
    return fs.existsSync(path.join(process.cwd(), '.claude', 'agents', `${name}.md`));
  }
  if (type === 'skill') {
    // Skills can be in skills/ OR commands/ folder
    return fs.existsSync(path.join(process.cwd(), '.claude', 'skills', `${name}.md`)) ||
           fs.existsSync(path.join(process.cwd(), '.claude', 'commands', `${name}.md`));
  }
  if (type === 'command') {
    return fs.existsSync(path.join(process.cwd(), '.claude', 'commands', `${name}.md`));
  }
  // For rules - always allow suggesting (user decides if it's in CLAUDE.md already)
  if (type === 'rule') {
    return false; // Always suggest rules, let Claude/user decide
  }
  if (type === 'hook') {
    return fs.existsSync(path.join(process.cwd(), 'hooks', 'hooks.json'));
  }
  return false;
}

function analyzeOutcomes(learnings: WinkLearnings, insights: SessionInsights): string[] {
  const newInsights: string[] = [];

  // Check if previously suggested agents were created and helped
  for (const suggestion of learnings.suggestions) {
    if (suggestion.type === 'agent' && !suggestion.outcome) {
      const exists = checkArtifactExists('agent', suggestion.name);

      if (exists) {
        suggestion.created = true;
        // Check if context loss improved (simplified check)
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

  // Learn from patterns
  if (learnings.suggestions.length >= 3) {
    const created = learnings.suggestions.filter(s => s.created).length;
    const total = learnings.suggestions.length;
    const adoptionRate = created / total;

    const lowAdoptionMsg = 'suggestions often ignored - may need higher thresholds';
    if (adoptionRate < 0.3 && !learnings.insights.includes(lowAdoptionMsg)) {
      newInsights.push(lowAdoptionMsg);
      learnings.patterns.hotFolderThreshold = Math.min(50, learnings.patterns.hotFolderThreshold + 10);
    }
  }

  return newInsights;
}

// Create an agent file from suggestion
function createAgent(suggestion: ArtifactSuggestion): boolean {
  if (suggestion.type !== 'agent') return false;

  const agentDir = path.join(process.cwd(), '.claude', 'agents');
  const agentPath = path.join(agentDir, `${suggestion.name}.md`);

  // Create directory if needed
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  // Generate agent content
  const folderName = suggestion.name.replace('-expert', '');
  const content = `---
name: ${suggestion.name}
description: ${suggestion.description}
tools: Read, Grep, Edit, Write
---

# ${folderName.charAt(0).toUpperCase() + folderName.slice(1)} Expert Agent

You are a specialized agent with deep knowledge of the \`${folderName}/\` directory.

## Evidence

${suggestion.metricEvidence}

## Your Expertise

- Understand patterns and conventions in ${folderName}/
- Know relationships between files in this area
- Can suggest edits that follow existing conventions
- Provide specific file references when asked

## Usage

Use this agent when working on code in the ${folderName}/ folder.
`;

  fs.writeFileSync(agentPath, content);
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const applyMode = args.includes('--apply');

  // Use all sessions for pattern detection and agent suggestions
  const allSessionsAnalyzer = new SessionAnalyzer({ allSessions: true });
  const insights = allSessionsAnalyzer.analyze();
  const learnings = loadLearnings();

  // Analyze outcomes from previous suggestions
  const newInsights = analyzeOutcomes(learnings, insights);
  if (newInsights.length > 0) {
    learnings.insights.push(...newInsights);
  }

  printMetrics(insights);
  const suggestions = printSuggestions(insights, learnings);

  // Handle --apply flag
  if (applyMode) {
    const agentSuggestions = suggestions.filter(s => s.type === 'agent');
    if (agentSuggestions.length === 0) {
      console.log(`${c.dim}no agents to create${c.reset}`);
    } else {
      console.log(`${c.bold}creating agents${c.reset}`);
      for (const s of agentSuggestions) {
        if (createAgent(s)) {
          console.log(`  ${c.green}✓${c.reset} created ${s.destination}`);
        }
      }
      console.log();
    }
  } else if (suggestions.filter(s => s.type === 'agent').length > 0) {
    console.log(`${c.dim}run with --apply to create suggested agents${c.reset}`);
    console.log();
  }

  printLearnings(learnings);

  // Run self-learning cycle and display report
  const learningReport = runLearningCycle(30);
  console.log(formatLearningReport(learningReport));

  // Record new suggestions
  const today = new Date().toISOString().split('T')[0];
  for (const s of suggestions) {
    const existing = learnings.suggestions.find(
      ls => ls.name === s.name && ls.date === today
    );
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

function printMetrics(insights: SessionInsights): void {
  console.log();
  console.log(`${c.bold}wink${c.reset} ${c.dim}· session analysis${c.reset}`);
  console.log();

  // One-line summary
  console.log(`${c.dim}${insights.projectType}${c.reset} · ${c.green}${insights.totalEdits}${c.reset} edits · ${c.cyan}${insights.totalReads}${c.reset} reads · ${insights.sessionDuration}min`);
  console.log();

  // Hot folders - compact
  if (insights.hotFolders.length > 0) {
    console.log(`${c.bold}hot folders${c.reset}`);
    for (const folder of insights.hotFolders.slice(0, 4)) {
      const name = folder.path.split('/').pop() || folder.path;
      const bar = '█'.repeat(Math.min(20, Math.round(folder.editCount / 5)));
      console.log(`  ${c.yellow}${bar}${c.reset} ${name} ${c.dim}(${folder.editCount})${c.reset}`);
    }
    console.log();
  }

  // Repeated reads - the key insight
  const highReads = insights.loopPatterns.filter(l => l.readCount >= 5);
  if (highReads.length > 0) {
    console.log(`${c.bold}context loss${c.reset} ${c.dim}(files read 5+ times)${c.reset}`);
    for (const loop of highReads.slice(0, 5)) {
      const color = loop.readCount >= 10 ? c.red : c.yellow;
      console.log(`  ${color}${loop.readCount}x${c.reset} ${loop.fileName}`);
    }
    console.log();
  }

  // Errors if any
  if (insights.commonErrors.length > 0) {
    console.log(`${c.bold}errors${c.reset}`);
    for (const error of insights.commonErrors.slice(0, 3)) {
      console.log(`  ${c.red}${error.count}x${c.reset} ${error.pattern}`);
    }
    console.log();
  }
}

// Find existing agents that match hot folders
function findExistingAgents(insights: SessionInsights): Array<{ name: string; folder: string; editCount: number }> {
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
}

// Generate consolidated artifact suggestions based on metrics
function generateSuggestions(insights: SessionInsights, learnings: WinkLearnings): ArtifactSuggestion[] {
  const suggestions: ArtifactSuggestion[] = [];
  const threshold = learnings.patterns.hotFolderThreshold;

  // Track which folders already have agents suggested (for consolidation)
  const suggestedFolders = new Set<string>();

  // AGENTS: One consolidated agent per hot folder (combines expert + context keeper)
  const projectRoot = process.cwd();
  for (const folder of insights.hotFolders.slice(0, 3)) {
    if (folder.editCount < threshold) continue;

    // Skip project root folder - agents for root files don't make sense
    if (folder.path === projectRoot) continue;

    const folderName = folder.path.split('/').pop() || 'core';
    const agentName = `${folderName}-expert`;

    if (checkArtifactExists('agent', agentName)) continue;
    if (suggestedFolders.has(folderName)) continue;
    suggestedFolders.add(folderName);

    // Find related file reads for this folder
    const relatedReads = insights.loopPatterns.filter(l =>
      l.file.includes(folder.path) || folder.path.includes(path.dirname(l.file))
    );
    const totalReads = relatedReads.reduce((a, b) => a + b.readCount, 0);

    // Build evidence string
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

  // RULES: Suggest rules for recurring error patterns
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

  // NOTE: Skills/commands suggestions removed - we can't reliably detect
  // "verify workflow" patterns from bash command count alone.
  // Future: analyze actual command content to detect build+test+lint sequences

  return suggestions;
}

function printSuggestions(insights: SessionInsights, learnings: WinkLearnings): ArtifactSuggestion[] {
  const suggestions = generateSuggestions(insights, learnings);
  const existingAgents = findExistingAgents(insights);

  // Group suggestions by type
  const newAgents = suggestions.filter(s => s.type === 'agent');
  const rules = suggestions.filter(s => s.type === 'rule');

  console.log(`${c.bold}agents${c.reset}`);
  console.log();

  // Show existing agents first
  if (existingAgents.length > 0) {
    console.log(`  ${c.green}available${c.reset}`);
    for (const a of existingAgents) {
      console.log(`    ${c.green}✓${c.reset} ${a.name} ${c.dim}(${a.editCount} edits in ${a.folder}/)${c.reset}`);
    }
    console.log();
  }

  // Show suggested (new) agents
  if (newAgents.length > 0) {
    console.log(`  ${c.cyan}suggested${c.reset}`);
    for (const a of newAgents) {
      console.log(`    ${c.cyan}+${c.reset} ${a.name}`);
      console.log(`      ${c.dim}${a.metricEvidence}${c.reset}`);
    }
    console.log();
  }

  // If no agents at all
  if (existingAgents.length === 0 && newAgents.length === 0) {
    console.log(`  ${c.dim}none yet - keep coding to generate suggestions${c.reset}`);
    console.log();
  }

  // Show rules if any
  if (rules.length > 0) {
    console.log(`${c.bold}rules${c.reset}`);
    console.log();
    for (const r of rules) {
      console.log(`  ${c.yellow}+${c.reset} ${r.name}`);
      console.log(`    ${c.dim}${r.metricEvidence}${c.reset}`);
    }
    console.log();
  }

  return suggestions;
}

function printLearnings(learnings: WinkLearnings): void {
  // Show learnings if any
  const recentInsights = learnings.insights.slice(-3);
  const effectiveAgents = learnings.patterns.effectiveAgents;

  if (recentInsights.length > 0 || effectiveAgents.length > 0) {
    console.log(`${c.bold}${c.magenta}learnings${c.reset}`);

    if (effectiveAgents.length > 0) {
      console.log(`  ${c.green}✓${c.reset} ${c.dim}effective: ${effectiveAgents.join(', ')}${c.reset}`);
    }

    for (const insight of recentInsights) {
      console.log(`  ${c.dim}• ${insight}${c.reset}`);
    }
    console.log();
  }

  // Show thresholds being used
  console.log(`${c.dim}thresholds: ${learnings.patterns.hotFolderThreshold} edits, ${learnings.patterns.contextLossThreshold} reads${c.reset}`);
  console.log(`${c.dim}ask Claude to create suggested artifacts${c.reset}`);
  console.log();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
