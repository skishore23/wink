/**
 * Threshold Manager
 *
 * Manages adaptive thresholds for agent suggestions based on measured effectiveness.
 * Thresholds adjust automatically based on how well agents perform.
 */

import {
  getAgentThreshold,
  updateAgentThreshold,
  getAgentEffectiveness,
  getAllAgentEffectiveness,
  getAllThresholds,
  ThresholdConfig
} from './storage';

export interface ThresholdAdjustment {
  agentType: string;
  oldValue: number;
  newValue: number;
  reason: string;
  effectivenessAvg: number;
}

/**
 * Minimum samples required before adjusting thresholds
 */
const MIN_SAMPLES_FOR_ADJUSTMENT = 5;

/**
 * Effectiveness thresholds for adjustment decisions
 */
const HIGH_EFFECTIVENESS = 0.6;  // Above this = agents are very helpful
const LOW_EFFECTIVENESS = 0.3;   // Below this = agents aren't helping

/**
 * Adjustment factors
 */
const AGGRESSIVE_FACTOR = 0.9;   // Reduce threshold by 10% when effective
const CONSERVATIVE_FACTOR = 1.15; // Increase threshold by 15% when ineffective

/**
 * Get the current threshold for an agent type
 */
export function getThreshold(agentType: string): number {
  const config = getAgentThreshold(agentType);
  return config.thresholdValue;
}

/**
 * Get all threshold configurations
 */
export function getThresholds(): ThresholdConfig[] {
  return getAllThresholds();
}

/**
 * Adjust threshold for a specific agent type based on effectiveness data
 */
export function adjustThreshold(agentType: string, days: number = 30): ThresholdAdjustment | null {
  const stats = getAgentEffectiveness(agentType, days);

  // Not enough data to make adjustments
  if (!stats || stats.sampleCount < MIN_SAMPLES_FOR_ADJUSTMENT) {
    return null;
  }

  const current = getAgentThreshold(agentType);
  let newValue = current.thresholdValue;
  let reason = '';

  if (stats.avgEffectiveness > HIGH_EFFECTIVENESS) {
    // Agents are very effective - suggest more aggressively (lower threshold)
    newValue = current.thresholdValue * AGGRESSIVE_FACTOR;
    reason = `high effectiveness (${(stats.avgEffectiveness * 100).toFixed(0)}%) - suggesting more`;
  } else if (stats.avgEffectiveness < LOW_EFFECTIVENESS) {
    // Agents aren't helping - suggest less (higher threshold)
    newValue = current.thresholdValue * CONSERVATIVE_FACTOR;
    reason = `low effectiveness (${(stats.avgEffectiveness * 100).toFixed(0)}%) - suggesting less`;
  } else {
    // Effectiveness is moderate - no adjustment needed
    return null;
  }

  // Clamp to min/max bounds
  newValue = Math.max(current.minValue, Math.min(current.maxValue, newValue));

  // Round to reasonable precision
  newValue = Math.round(newValue * 10) / 10;

  // Don't adjust if change is too small
  if (Math.abs(newValue - current.thresholdValue) < 0.5) {
    return null;
  }

  // Save the adjustment
  updateAgentThreshold(
    agentType,
    newValue,
    stats.avgEffectiveness,
    stats.sampleCount
  );

  return {
    agentType,
    oldValue: current.thresholdValue,
    newValue,
    reason,
    effectivenessAvg: stats.avgEffectiveness
  };
}

/**
 * Adjust all thresholds based on effectiveness data
 */
export function adjustAllThresholds(days: number = 30): ThresholdAdjustment[] {
  const adjustments: ThresholdAdjustment[] = [];

  // Get all agent types that have usage data
  const allStats = getAllAgentEffectiveness(days);

  for (const stats of allStats) {
    const adjustment = adjustThreshold(stats.agentType, days);
    if (adjustment) {
      adjustments.push(adjustment);
    }
  }

  return adjustments;
}

/**
 * Get effectiveness report for all agent types
 */
export interface EffectivenessReport {
  agentType: string;
  threshold: number;
  samples: number;
  avgEffectiveness: number;
  successRate: number;
  status: 'effective' | 'moderate' | 'ineffective' | 'insufficient-data';
}

export function getEffectivenessReport(days: number = 30): EffectivenessReport[] {
  const allStats = getAllAgentEffectiveness(days);
  const reports: EffectivenessReport[] = [];

  for (const stats of allStats) {
    const config = getAgentThreshold(stats.agentType);

    let status: EffectivenessReport['status'];
    if (stats.sampleCount < MIN_SAMPLES_FOR_ADJUSTMENT) {
      status = 'insufficient-data';
    } else if (stats.avgEffectiveness > HIGH_EFFECTIVENESS) {
      status = 'effective';
    } else if (stats.avgEffectiveness < LOW_EFFECTIVENESS) {
      status = 'ineffective';
    } else {
      status = 'moderate';
    }

    reports.push({
      agentType: stats.agentType,
      threshold: config.thresholdValue,
      samples: stats.sampleCount,
      avgEffectiveness: stats.avgEffectiveness,
      successRate: stats.successRate,
      status
    });
  }

  return reports;
}

/**
 * Reset threshold to default for an agent type
 */
export function resetThreshold(agentType: string): void {
  const defaults: Record<string, number> = {
    'folder-expert': 20,
    'error-fixer': 3,
    'context-keeper': 5,
    'language-specialist': 1,
    'quality-guard': 1,
    'regression-fixer': 1
  };

  const defaultValue = defaults[agentType] ?? 10;

  updateAgentThreshold(
    agentType,
    defaultValue,
    0.5,  // Neutral effectiveness
    0     // Reset sample count
  );
}

/**
 * Check if an agent type should be suggested based on current metrics
 */
export function shouldSuggestAgent(
  agentType: string,
  currentMetric: number
): { suggest: boolean; reason?: string } {
  const threshold = getThreshold(agentType);

  if (currentMetric >= threshold) {
    return { suggest: true };
  }

  return {
    suggest: false,
    reason: `metric ${currentMetric} below threshold ${threshold}`
  };
}

/**
 * Adjust thresholds based on session efficiency score
 *
 * When efficiency is low (lots of wasted reads, loops), we want to:
 * - Lower thresholds so agents get suggested earlier
 * - Help break bad patterns before they compound
 *
 * When efficiency is high, we can be more conservative.
 */
export function adjustThresholdsForEfficiency(efficiencyScore: number): ThresholdAdjustment[] {
  const adjustments: ThresholdAdjustment[] = [];

  // Only adjust if efficiency is notably poor or good
  if (efficiencyScore >= 40 && efficiencyScore <= 75) {
    return adjustments; // Moderate efficiency, no adjustment
  }

  const agentTypes = ['folder-expert', 'error-fixer', 'context-keeper'];

  for (const agentType of agentTypes) {
    const current = getAgentThreshold(agentType);
    let newValue = current.thresholdValue;
    let reason = '';

    if (efficiencyScore < 40) {
      // Poor efficiency - lower thresholds to suggest agents earlier
      newValue = current.thresholdValue * 0.8;
      reason = `low session efficiency (${efficiencyScore}/100) - suggesting agents earlier`;
    } else if (efficiencyScore > 75) {
      // High efficiency - can raise thresholds slightly
      newValue = current.thresholdValue * 1.1;
      reason = `high session efficiency (${efficiencyScore}/100) - being more selective`;
    }

    // Clamp to min/max bounds
    newValue = Math.max(current.minValue, Math.min(current.maxValue, newValue));
    newValue = Math.round(newValue * 10) / 10;

    // Only adjust if change is meaningful
    if (Math.abs(newValue - current.thresholdValue) >= 0.5) {
      updateAgentThreshold(
        agentType,
        newValue,
        current.effectivenessAvg,
        current.sampleCount
      );

      adjustments.push({
        agentType,
        oldValue: current.thresholdValue,
        newValue,
        reason,
        effectivenessAvg: current.effectivenessAvg
      });
    }
  }

  return adjustments;
}
