/**
 * Learning Engine
 *
 * Orchestrates the self-learning system by:
 * 1. Calculating effectiveness scores
 * 2. Clustering errors into patterns
 * 3. Adjusting thresholds based on data
 * 4. Evaluating agent performance
 * 5. Generating learning insights
 */

import {
  getAllAgentEffectiveness,
  AgentEffectivenessStats,
  ErrorPattern
} from './storage';

import {
  adjustAllThresholds,
  getEffectivenessReport,
  ThresholdAdjustment
} from './thresholdManager';

import { predictAgent, AgentPrediction } from './agentPredictor';
import { getLearnedPatterns } from './errorLearning';

export interface LearningReport {
  // Effectiveness data
  agentEffectiveness: AgentEffectivenessStats[];
  effectiveAgents: string[];
  ineffectiveAgents: string[];

  // Threshold adjustments made
  thresholdAdjustments: ThresholdAdjustment[];

  // Error patterns learned
  errorPatterns: ErrorPattern[];
  topErrorCategories: Array<{ category: string; count: number }>;

  // Predictions
  currentPrediction: AgentPrediction | null;

  // Insights
  insights: string[];

  // Stats
  totalAgentUsages: number;
  averageEffectiveness: number;
}

/**
 * Run the complete learning cycle
 */
export function runLearningCycle(days: number = 30): LearningReport {
  const insights: string[] = [];

  // 1. Get agent effectiveness data
  const agentEffectiveness = getAllAgentEffectiveness(days);
  const totalUsages = agentEffectiveness.reduce((sum, a) => sum + a.sampleCount, 0);
  const avgEffectiveness = agentEffectiveness.length > 0
    ? agentEffectiveness.reduce((sum, a) => sum + a.avgEffectiveness * a.sampleCount, 0) / totalUsages
    : 0;

  // Categorize agents
  const effectiveAgents = agentEffectiveness
    .filter(a => a.avgEffectiveness >= 0.6 && a.sampleCount >= 3)
    .map(a => a.agentType);

  const ineffectiveAgents = agentEffectiveness
    .filter(a => a.avgEffectiveness < 0.3 && a.sampleCount >= 3)
    .map(a => a.agentType);

  if (effectiveAgents.length > 0) {
    insights.push(`Effective agents: ${effectiveAgents.join(', ')}`);
  }

  if (ineffectiveAgents.length > 0) {
    insights.push(`Consider improving or removing: ${ineffectiveAgents.join(', ')}`);
  }

  // 2. Adjust thresholds based on effectiveness
  const thresholdAdjustments = adjustAllThresholds(days);

  for (const adj of thresholdAdjustments) {
    insights.push(`Threshold ${adj.agentType}: ${adj.oldValue} → ${adj.newValue} (${adj.reason})`);
  }

  // 3. Get learned error patterns
  const errorPatterns = getLearnedPatterns(10);

  // Group by category
  const categoryMap = new Map<string, number>();
  for (const pattern of errorPatterns) {
    const cat = pattern.category || 'unknown';
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + pattern.occurrenceCount);
  }

  const topErrorCategories = [...categoryMap.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (topErrorCategories.length > 0) {
    const topCat = topErrorCategories[0];
    insights.push(`Most common error type: ${topCat.category} (${topCat.count} occurrences)`);
  }

  // 4. Get current prediction
  const currentPrediction = predictAgent();

  if (currentPrediction && currentPrediction.confidence >= 0.5) {
    insights.push(`Predicted helpful agent: ${currentPrediction.agentName} (${Math.round(currentPrediction.confidence * 100)}% confidence)`);
  }

  // 5. Generate additional insights
  if (totalUsages === 0) {
    insights.push('No agent usage data yet - use agents to start learning');
  } else if (totalUsages < 10) {
    insights.push(`Learning from ${totalUsages} agent usages - more data will improve predictions`);
  }

  if (avgEffectiveness > 0 && avgEffectiveness < 0.4) {
    insights.push('Overall agent effectiveness is low - consider refining agent definitions');
  }

  return {
    agentEffectiveness,
    effectiveAgents,
    ineffectiveAgents,
    thresholdAdjustments,
    errorPatterns,
    topErrorCategories,
    currentPrediction,
    insights,
    totalAgentUsages: totalUsages,
    averageEffectiveness: avgEffectiveness
  };
}

/**
 * Get a summary of learning status
 */
export function getLearningStatus(): {
  hasData: boolean;
  agentUsages: number;
  errorPatterns: number;
  thresholdsAdjusted: number;
} {
  const effectiveness = getAllAgentEffectiveness(30);
  const patterns = getLearnedPatterns(100);
  const reports = getEffectivenessReport(30);

  const adjustedCount = reports.filter(r =>
    r.status === 'effective' || r.status === 'ineffective'
  ).length;

  return {
    hasData: effectiveness.length > 0 || patterns.length > 0,
    agentUsages: effectiveness.reduce((sum, e) => sum + e.sampleCount, 0),
    errorPatterns: patterns.length,
    thresholdsAdjusted: adjustedCount
  };
}

/**
 * Format learning report for display
 */
export function formatLearningReport(report: LearningReport): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('\x1b[1mlearning\x1b[0m');
  lines.push('');

  // Effectiveness summary
  if (report.totalAgentUsages > 0) {
    const avgPct = Math.round(report.averageEffectiveness * 100);
    lines.push(`  agents used: ${report.totalAgentUsages} (avg effectiveness: ${avgPct}%)`);

    if (report.effectiveAgents.length > 0) {
      lines.push(`  \x1b[32m✓\x1b[0m effective: ${report.effectiveAgents.join(', ')}`);
    }

    if (report.ineffectiveAgents.length > 0) {
      lines.push(`  \x1b[31m✗\x1b[0m ineffective: ${report.ineffectiveAgents.join(', ')}`);
    }
  } else {
    lines.push('  \x1b[2mno agent usage data yet\x1b[0m');
  }

  // Threshold adjustments
  if (report.thresholdAdjustments.length > 0) {
    lines.push('');
    lines.push('  \x1b[1mthreshold adjustments\x1b[0m');
    for (const adj of report.thresholdAdjustments) {
      lines.push(`    ${adj.agentType}: ${adj.oldValue} → ${adj.newValue}`);
    }
  }

  // Error patterns
  if (report.errorPatterns.length > 0) {
    lines.push('');
    lines.push(`  error patterns: ${report.errorPatterns.length} learned`);
    if (report.topErrorCategories.length > 0) {
      const top = report.topErrorCategories[0];
      lines.push(`    top: ${top.category} (${top.count}x)`);
    }
  }

  // Prediction
  if (report.currentPrediction) {
    lines.push('');
    const conf = Math.round(report.currentPrediction.confidence * 100);
    lines.push(`  \x1b[36m💡\x1b[0m predicted: ${report.currentPrediction.agentName} (${conf}%)`);
  }

  // Insights
  if (report.insights.length > 0) {
    lines.push('');
    lines.push('  \x1b[1minsights\x1b[0m');
    for (const insight of report.insights.slice(0, 5)) {
      lines.push(`    • ${insight}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}
