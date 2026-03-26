/**
 * Quality Score Calculator
 *
 * Measures ASO signal quality (are suggestions accurate and actionable?).
 * Complements the Health Score which measures customer execution throughput.
 *
 * Components (weighted):
 *   Rejection Rate (40%) — REJECTED / total suggestions (ESE false-positive rate)
 *   Outdated Rate  (30%) — OUTDATED / total suggestions (signal staleness)
 *   Fix Error Rate (30%) — FAILED / (COMPLETED + FAILED) from /fixes (automation reliability)
 */

export const QUALITY_CONFIG = {
  weights: {
    rejectionRate: 0.40,
    outdatedRate: 0.30,
    fixErrorRate: 0.30,
  },
  targets: {
    maxRejectionRate: 0.03, // ≤3% is excellent
    maxOutdatedRate: 0.10, // ≤10% is excellent
    maxFixErrorRate: 0.05, // ≤5% is excellent
  },
};

/**
 * Calculate Quality Score.
 *
 * @param {Object} suggestionCounts — from aggregateSuggestionsAcrossOpportunities
 *   { totalCount, rejectedRawCount, outdatedCount }
 * @param {Object} fixCounts — { completedFixes, failedFixes, totalFixes }
 * @returns {{ score: number, achievements: Object, metrics: Object }}
 */
export function calculateQualityScore(
  suggestionCounts = {},
  fixCounts = {},
  config = QUALITY_CONFIG,
) {
  const { weights, targets } = config;
  const total = suggestionCounts.totalCount || 0;
  const rejected = suggestionCounts.rejectedRawCount || 0;
  const outdated = suggestionCounts.outdatedCount || 0;
  const completed = fixCounts.completedFixes || 0;
  const failed = fixCounts.failedFixes || 0;

  // --- Rates ---
  const rejectionRate = total > 0 ? rejected / total : 0;
  const outdatedRate = total > 0 ? outdated / total : 0;
  const fixTotal = completed + failed;
  const fixErrorRate = fixTotal > 0 ? failed / fixTotal : 0;

  // --- Achievements (0–100 each, higher is better) ---
  function achievement(rate, maxTarget, penaltyRange = 0.15) {
    if (rate <= maxTarget) return 100;
    return Math.max(0, (1 - (rate - maxTarget) / penaltyRange) * 100);
  }

  const achievements = {
    rejectionRate: achievement(rejectionRate, targets.maxRejectionRate, 0.12),
    outdatedRate: achievement(outdatedRate, targets.maxOutdatedRate, 0.20),
    fixErrorRate: fixTotal > 0
      ? achievement(fixErrorRate, targets.maxFixErrorRate, 0.15)
      : 75, // neutral if no fix data
  };

  const score = Math.min(100, Math.max(0, Math.round(
    achievements.rejectionRate * weights.rejectionRate
    + achievements.outdatedRate * weights.outdatedRate
    + achievements.fixErrorRate * weights.fixErrorRate,
  )));

  return {
    score,
    achievements,
    metrics: {
      rejectionRate: parseFloat((rejectionRate * 100).toFixed(1)),
      rejectedCount: rejected,
      outdatedRate: parseFloat((outdatedRate * 100).toFixed(1)),
      outdatedCount: outdated,
      fixErrorRate: parseFloat((fixErrorRate * 100).toFixed(1)),
      fixFailedCount: failed,
      fixCompletedCount: completed,
      totalSuggestions: total,
    },
  };
}

/**
 * Get quality label from score.
 */
export function getQualityLabel(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'critical';
}
