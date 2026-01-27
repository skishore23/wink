/**
 * Printer - Beautiful CLI output for wink
 * 
 * Consistent styling, clean separation of concerns
 */

// ANSI escape codes
const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// Colors
const colors = {
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
} as const;

// Styles
const styles = {
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,
} as const;

// Semantic colors
const theme = {
  primary: colors.cyan,
  success: colors.green,
  warning: colors.yellow,
  error: colors.red,
  muted: colors.gray,
  accent: colors.magenta,
  info: colors.blue,
};

// Icons
const icons = {
  check: '✓',
  cross: '✗',
  plus: '+',
  arrow: '→',
  dot: '·',
  bar: '█',
  lightBar: '░',
  bullet: '•',
  sparkle: '✦',
  wink: '😉',
};

// Logo variants
const logo = {
  // Minimal inline logo
  inline: `✦ wink`,
  
  // Compact sparkle
  compact: `
    ·  ✦  ·
   ✦ wink ✦
    ·  ✦  ·
`,

  // ASCII art wink face
  face: `
      ╭─────╮
      │ ᵔ ‿ ─
      ╰─────╯
`,

  // Stylized text with sparkles
  sparkle: `
   ✦        ✦
     wink
   ✦        ✦
`,

  // Clean banner
  banner: `
  ╭──────────────╮
  │   ✦  wink    │
  ╰──────────────╯
`,
};

// ============================================================================
// Core formatting functions
// ============================================================================

const fmt = {
  bold: (s: string) => `${styles.bold}${s}${RESET}`,
  dim: (s: string) => `${styles.dim}${s}${RESET}`,
  italic: (s: string) => `${styles.italic}${s}${RESET}`,
  
  // Colors
  red: (s: string) => `${colors.red}${s}${RESET}`,
  green: (s: string) => `${colors.green}${s}${RESET}`,
  yellow: (s: string) => `${colors.yellow}${s}${RESET}`,
  cyan: (s: string) => `${colors.cyan}${s}${RESET}`,
  magenta: (s: string) => `${colors.magenta}${s}${RESET}`,
  blue: (s: string) => `${colors.blue}${s}${RESET}`,
  gray: (s: string) => `${colors.gray}${s}${RESET}`,
  
  // Semantic
  success: (s: string) => `${theme.success}${s}${RESET}`,
  warning: (s: string) => `${theme.warning}${s}${RESET}`,
  error: (s: string) => `${theme.error}${s}${RESET}`,
  muted: (s: string) => `${theme.muted}${s}${RESET}`,
  accent: (s: string) => `${theme.accent}${s}${RESET}`,
  primary: (s: string) => `${theme.primary}${s}${RESET}`,
};

// ============================================================================
// Component renderers
// ============================================================================

/**
 * Print the wink logo
 */
export function printLogo(style: 'minimal' | 'compact' | 'banner' = 'minimal'): void {
  if (style === 'banner') {
    console.log(fmt.primary(logo.banner));
  } else if (style === 'compact') {
    console.log(fmt.primary(logo.compact));
  } else {
    console.log();
    console.log(`  ${fmt.primary(icons.sparkle)} ${fmt.bold(fmt.primary('wink'))}`);
  }
}

/**
 * Print the wink header
 */
export function printHeader(): void {
  console.log();
  console.log(`  ${fmt.primary(icons.sparkle)} ${fmt.bold(fmt.primary('wink'))} ${fmt.muted(icons.dot)} ${fmt.muted('session analysis')}`);
  console.log();
}

/**
 * Print a section heading
 */
export function printSection(title: string): void {
  console.log(fmt.bold(title));
}

/**
 * Print a one-line summary
 * Duration is omitted if > 24 hours (meaningless for aggregated sessions)
 */
export function printSummary(projectType: string, edits: number, reads: number, duration: number): void {
  const parts = [
    fmt.muted(projectType),
    `${fmt.success(String(edits))} edits`,
    `${fmt.primary(String(reads))} reads`,
  ];

  // Only show duration if less than 24 hours (1440 min) - otherwise it's wall clock time
  if (duration > 0 && duration < 1440) {
    parts.push(`${duration}min`);
  }

  console.log(parts.join(` ${fmt.muted(icons.dot)} `));
  console.log();
}

/**
 * Print a progress bar
 */
function progressBar(value: number, max: number, width: number = 20): string {
  const filled = Math.min(width, Math.round((value / max) * width));
  return icons.bar.repeat(filled);
}

/**
 * Print hot folders with visual bars
 */
export function printHotFolders(folders: Array<{ path: string; editCount: number }>): void {
  if (folders.length === 0) return;
  
  printSection('hot folders');
  
  const maxEdits = Math.max(...folders.map(f => f.editCount));
  
  for (const folder of folders.slice(0, 4)) {
    const name = folder.path.split('/').pop() || folder.path;
    const bar = progressBar(folder.editCount, maxEdits);
    console.log(`  ${fmt.yellow(bar)} ${name} ${fmt.muted(`(${folder.editCount})`)}`);
  }
  console.log();
}

/**
 * Print context loss warnings
 */
export function printContextLoss(patterns: Array<{ fileName: string; readCount: number }>): void {
  const highReads = patterns.filter(l => l.readCount >= 5);
  if (highReads.length === 0) return;
  
  printSection(`context loss ${fmt.muted('(files read 5+ times)')}`);
  
  for (const loop of highReads.slice(0, 5)) {
    const color = loop.readCount >= 10 ? fmt.error : fmt.warning;
    console.log(`  ${color(`${loop.readCount}x`)} ${loop.fileName}`);
  }
  console.log();
}

/**
 * Print error patterns
 */
export function printErrors(errors: Array<{ pattern: string; count: number }>): void {
  if (errors.length === 0) return;

  printSection('errors');

  for (const error of errors.slice(0, 3)) {
    console.log(`  ${fmt.error(`${error.count}x`)} ${error.pattern}`);
  }
  console.log();
}

/**
 * Print command patterns for skill suggestions
 */
export function printCommandPatterns(patterns: Array<{ command: string; count: number }>): void {
  // Only show patterns that appear 3+ times (worth automating)
  const significant = patterns.filter(p => p.count >= 3);
  if (significant.length === 0) return;

  printSection('repetitive commands');

  for (const pattern of significant.slice(0, 5)) {
    console.log(`  ${fmt.accent(`${pattern.count}x`)} ${pattern.command}`);
  }
  console.log();
}

/**
 * Print existing agents
 */
export function printExistingAgents(agents: Array<{ name: string; folder: string; editCount: number }>): void {
  if (agents.length === 0) return;
  
  console.log(`  ${fmt.success('available')}`);
  for (const a of agents) {
    console.log(`    ${fmt.success(icons.check)} ${a.name} ${fmt.muted(`(${a.editCount} edits in ${a.folder}/)`)}`);
  }
  console.log();
}

/**
 * Print suggested agents
 */
export function printSuggestedAgents(suggestions: Array<{ name: string; evidence: string }>): void {
  if (suggestions.length === 0) return;
  
  console.log(`  ${fmt.primary('suggested')}`);
  for (const s of suggestions) {
    console.log(`    ${fmt.primary(icons.plus)} ${s.name}`);
    console.log(`      ${fmt.muted(s.evidence)}`);
  }
  console.log();
}

/**
 * Print agents section header
 */
export function printAgentsHeader(): void {
  printSection('agents');
  console.log();
}

/**
 * Print when no agents exist
 */
export function printNoAgents(): void {
  console.log(`  ${fmt.muted('none yet - keep coding to generate suggestions')}`);
  console.log();
}

/**
 * Print rules suggestions
 */
export function printRules(rules: Array<{ name: string; evidence: string }>): void {
  if (rules.length === 0) return;

  printSection('rules');
  console.log();

  for (const r of rules) {
    console.log(`  ${fmt.warning(icons.plus)} ${r.name}`);
    console.log(`    ${fmt.muted(r.evidence)}`);
  }
  console.log();
}

/**
 * Print skill suggestions
 */
export function printSuggestedSkills(skills: Array<{ name: string; evidence: string }>): void {
  if (skills.length === 0) return;

  printSection('skills');
  console.log();

  console.log(`  ${fmt.accent('suggested')}`);
  for (const s of skills) {
    console.log(`    ${fmt.accent(icons.plus)} ${s.name}`);
    console.log(`      ${fmt.muted(s.evidence)}`);
  }
  console.log();
}

/**
 * Print thresholds info
 */
export function printThresholds(editThreshold: number, readThreshold: number): void {
  console.log(fmt.muted(`thresholds: ${editThreshold} edits, ${readThreshold} reads`));
}

/**
 * Print apply hint
 */
export function printApplyHint(): void {
  console.log(fmt.muted('run with --apply to create suggested agents'));
  console.log();
}

/**
 * Print learnings section
 */
export function printLearnings(data: {
  effectiveAgents: string[];
  insights: string[];
}): void {
  if (data.effectiveAgents.length === 0 && data.insights.length === 0) return;
  
  printSection(fmt.accent('learnings'));
  
  if (data.effectiveAgents.length > 0) {
    console.log(`  ${fmt.success(icons.check)} ${fmt.muted(`effective: ${data.effectiveAgents.join(', ')}`)}`);
  }
  
  for (const insight of data.insights.slice(-3)) {
    console.log(`  ${fmt.muted(`${icons.bullet} ${insight}`)}`);
  }
  console.log();
}

// ============================================================================
// Agent generation instructions (for --apply mode)
// ============================================================================

export function printGenerationHeader(): void {
  console.log();
  console.log(fmt.primary(`  ${icons.sparkle} ─────────────────────────────`));
  console.log(fmt.bold(fmt.primary('    AGENT GENERATION')));
  console.log(fmt.primary(`  ${icons.sparkle} ─────────────────────────────`));
  console.log();
  console.log('  Generate the following agents with rich content.');
  console.log(`  Use ${fmt.cyan('Read')} and ${fmt.cyan('LSP')} to extract actual exports/patterns.`);
  console.log();
}

export function printAgentToGenerate(data: {
  name: string;
  folder: string;
  evidence: string;
  hotFiles: string[];
  destination: string;
}): void {
  console.log(fmt.bold(`${icons.sparkle} ${data.name}`));
  console.log(`  ${fmt.muted('folder:')} ${data.folder}`);
  console.log(`  ${fmt.muted('evidence:')} ${data.evidence}`);
  console.log(`  ${fmt.muted('analyze:')}`);
  
  if (data.hotFiles.length > 0) {
    for (const f of data.hotFiles) {
      console.log(`    ${fmt.muted(icons.arrow)} ${f}`);
    }
  } else {
    console.log(`    ${fmt.muted(icons.arrow)} (list files in ${data.folder})`);
  }
  
  console.log(`  ${fmt.muted('output:')} ${fmt.cyan(data.destination)}`);
  console.log();
}

export function printGenerationSteps(): void {
  console.log(fmt.bold('Steps for each agent:'));
  console.log(`  ${fmt.muted('1.')} Read the hot files listed above`);
  console.log(`  ${fmt.muted('2.')} Extract exports, function signatures, key types`);
  console.log(`  ${fmt.muted('3.')} Identify patterns and conventions`);
  console.log(`  ${fmt.muted('4.')} Write to ${fmt.cyan('.claude/agents/{name}.md')} with rich content`);
  console.log();
  console.log(fmt.muted('This creates agents that carry actual knowledge.'));
  console.log();
}

export function printNoAgentsToGenerate(): void {
  console.log(fmt.muted('no agents to create'));
}

/**
 * Print context hygiene metrics
 */
export function printContextHygiene(hygiene: {
  wastedReads: Array<{ file: string; count: number }>;
  deadFiles: string[];
  efficiency: {
    score: number;
    uniqueFilesRead: number;
    uniqueFilesEdited: number;
    focusRatio: number;
    loopCount: number;
    searchEfficiency: number;
  };
  searchFunnels: Array<{ pattern: string; effectiveness: number }>;
}): void {
  printSection('context hygiene');
  console.log();

  // Efficiency score with visual indicator
  const score = hygiene.efficiency.score;
  const scoreColor = score >= 70 ? fmt.success : score >= 50 ? fmt.warning : fmt.error;
  const scoreBar = progressBar(score, 100, 15);
  console.log(`  ${scoreColor(scoreBar)} efficiency: ${scoreColor(`${score}/100`)}`);

  // Focus ratio
  const focus = hygiene.efficiency.focusRatio.toFixed(2);
  const focusDesc = `${hygiene.efficiency.uniqueFilesRead} read ${icons.arrow} ${hygiene.efficiency.uniqueFilesEdited} edited`;
  console.log(`  ${fmt.muted('focus:')} ${focus} ${fmt.muted(`(${focusDesc})`)}`);

  // Loops
  if (hygiene.efficiency.loopCount > 0) {
    console.log(`  ${fmt.warning(icons.bullet)} ${hygiene.efficiency.loopCount} file${hygiene.efficiency.loopCount > 1 ? 's' : ''} read 3+ times`);
  }

  // Wasted reads
  if (hygiene.wastedReads.length > 0) {
    console.log(`  ${fmt.error(icons.bullet)} ${hygiene.wastedReads.length} files read but never edited`);
    for (const w of hygiene.wastedReads.slice(0, 3)) {
      const fileName = w.file.split('/').pop() || w.file;
      console.log(`    ${fmt.muted(icons.arrow)} ${fileName} ${fmt.muted(`(${w.count}x)`)}`);
    }
  }

  // Dead files
  if (hygiene.deadFiles.length > 0) {
    console.log(`  ${fmt.error(icons.bullet)} ${hygiene.deadFiles.length} created but never imported`);
    for (const f of hygiene.deadFiles.slice(0, 2)) {
      const fileName = f.split('/').pop() || f;
      console.log(`    ${fmt.muted(icons.arrow)} ${fileName}`);
    }
  }

  // Search efficiency
  if (hygiene.searchFunnels.length > 0) {
    const effective = hygiene.searchFunnels.filter(s => s.effectiveness > 0).length;
    const total = hygiene.searchFunnels.length;
    const pct = Math.round((effective / total) * 100);
    const searchColor = pct >= 70 ? fmt.success : pct >= 40 ? fmt.warning : fmt.error;
    console.log(`  ${fmt.muted('search')} ${icons.arrow} ${fmt.muted('edit:')} ${searchColor(`${effective}/${total}`)} ${fmt.muted(`(${pct}%)`)}`);
  }

  console.log();
}

// ============================================================================
// Learning report formatting
// ============================================================================

export function printLearningReport(report: {
  totalAgentUsages: number;
  averageEffectiveness: number;
  effectiveAgents: string[];
  ineffectiveAgents: string[];
  thresholdAdjustments: Array<{ agentType: string; oldValue: number; newValue: number }>;
  topErrorCategories: Array<{ category: string; count: number }>;
  currentPrediction: { agentName: string; confidence: number } | null;
  insights: string[];
}): void {
  console.log();
  printSection('learning');
  console.log();
  
  // Effectiveness summary
  if (report.totalAgentUsages > 0) {
    const avgPct = Math.round(report.averageEffectiveness * 100);
    console.log(`  agents used: ${report.totalAgentUsages} ${fmt.muted(`(avg effectiveness: ${avgPct}%)`)}`);
    
    if (report.effectiveAgents.length > 0) {
      console.log(`  ${fmt.success(icons.check)} effective: ${report.effectiveAgents.join(', ')}`);
    }
    
    if (report.ineffectiveAgents.length > 0) {
      console.log(`  ${fmt.error(icons.cross)} ineffective: ${report.ineffectiveAgents.join(', ')}`);
    }
  } else {
    console.log(`  ${fmt.muted('no agent usage data yet')}`);
  }
  
  // Threshold adjustments
  if (report.thresholdAdjustments.length > 0) {
    console.log();
    console.log(`  ${fmt.bold('threshold adjustments')}`);
    for (const adj of report.thresholdAdjustments) {
      console.log(`    ${adj.agentType}: ${adj.oldValue} ${icons.arrow} ${adj.newValue}`);
    }
  }
  
  // Error patterns
  if (report.topErrorCategories.length > 0) {
    console.log();
    const top = report.topErrorCategories[0];
    console.log(`  error patterns: ${report.topErrorCategories.length} learned`);
    console.log(`    top: ${top.category} ${fmt.muted(`(${top.count}x)`)}`);
  }
  
  // Prediction
  if (report.currentPrediction && report.currentPrediction.confidence >= 0.3) {
    console.log();
    const conf = Math.round(report.currentPrediction.confidence * 100);
    console.log(`  ${fmt.primary('💡')} predicted: ${report.currentPrediction.agentName} ${fmt.muted(`(${conf}%)`)}`);
  }
  
  // Insights
  if (report.insights.length > 0) {
    console.log();
    console.log(`  ${fmt.bold('insights')}`);
    for (const insight of report.insights.slice(0, 5)) {
      console.log(`    ${fmt.muted(icons.bullet)} ${insight}`);
    }
  }

  console.log();
}

/**
 * Print simplified learning report (no auto-adjustments)
 */
export function printSimpleLearningReport(report: {
  errorSummary: Array<{ category: string; count: number }>;
  thresholds: Array<{ agentType: string; thresholdValue: number }>;
  insights: string[];
}): void {
  console.log();
  printSection('learning data');
  console.log();

  // Error summary
  if (report.errorSummary.length > 0) {
    console.log(`  ${fmt.bold('errors by category')}`);
    for (const error of report.errorSummary.slice(0, 5)) {
      console.log(`    ${error.category}: ${error.count}`);
    }
  } else {
    console.log(`  ${fmt.muted('no errors recorded')}`);
  }

  // Insights
  if (report.insights.length > 0) {
    console.log();
    console.log(`  ${fmt.bold('insights')}`);
    for (const insight of report.insights) {
      console.log(`    ${fmt.muted(icons.bullet)} ${insight}`);
    }
  }

  console.log();
}
