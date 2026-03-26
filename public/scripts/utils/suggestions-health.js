/**
 * Suggestions Health Utilities
 *
 * Calculates lifecycle metrics, health scores, and aggregations for
 * ASO opportunities and suggestions.
 *
 * Adapted from llmo-spacecat-dashboard/src/utils/opportunitiesHealth.js
 */

import { SUGGESTION_STATUS, OPPORTUNITY_STATUS } from '../constants/api.js';

/**
 * Age thresholds in days for categorizing opportunity/suggestion age
 */
export const AGE_THRESHOLDS = {
  fresh: 7, // 0-7 days
  acceptable: 14, // 8-14 days
  warning: 30, // 15-30 days
  overdue: 60, // 31-60 days
  // > 60 days is critical
};

/**
 * Health score configuration
 */
export const HEALTH_CONFIG = {
  // Weights for different health factors (must sum to 1.0)
  weights: {
    resolutionRate: 0.35,
    agingRate: 0.25,
    speedOfResolution: 0.25,
    rejectionRate: 0.15,
  },
  // Target values for 100% achievement
  targets: {
    resolutionRate: 0.8, // 80% resolved is excellent
    maxAgingRate: 0.1, // Less than 10% aging is excellent
    avgDaysToFix: 14, // 14 days average is excellent
    maxRejectionRate: 0.05, // Less than 5% rejected is excellent
  },
};

/**
 * Terminal statuses for opportunities and suggestions.
 * Items in these statuses use (updatedAt - createdAt) for age instead of (now - createdAt).
 */
const TERMINAL_OPP_STATUSES = new Set([OPPORTUNITY_STATUS.RESOLVED, OPPORTUNITY_STATUS.IGNORED]);
const TERMINAL_SUG_STATUSES = new Set([
  SUGGESTION_STATUS.FIXED,
  SUGGESTION_STATUS.SKIPPED,
  SUGGESTION_STATUS.REJECTED,
  SUGGESTION_STATUS.ERROR,
  SUGGESTION_STATUS.OUTDATED,
]);

/**
 * Calculate the age in days for an item.
 * - For items in a terminal state (deployed/ignored/resolved/skipped), age = updatedAt - createdAt
 *   (how long the item was open before reaching its final state).
 * - For active items, age = now - createdAt (how long it's been open).
 *
 * @param {string|Date} createdAt - Creation date
 * @param {string|Date} [updatedAt] - Last update date (used for terminal-state items)
 * @param {string} [status] - Current status of the item
 * @param {'opportunity'|'suggestion'} [itemType='opportunity'] - Type of item
 * @returns {number} Age in days, or -1 if invalid
 */
export function calculateAgeDays(createdAt, updatedAt = null, status = null, itemType = 'opportunity') {
  if (!createdAt) return -1;

  try {
    const created = new Date(createdAt);

    // For terminal-state items, measure time-to-resolution (updatedAt - createdAt)
    const terminalSet = itemType === 'suggestion' ? TERMINAL_SUG_STATUSES : TERMINAL_OPP_STATUSES;
    if (status && terminalSet.has(status) && updatedAt) {
      const updated = new Date(updatedAt);
      const diffDays = Math.floor((updated - created) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 ? diffDays : -1;
    }

    // For active items, measure time since creation
    const now = new Date();
    const diffMs = now - created;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= 0 ? diffDays : -1;
  } catch {
    return -1;
  }
}

/**
 * Calculate age bucket for an item.
 * For terminal-state items (RESOLVED/IGNORED/FIXED/SKIPPED), uses time-to-resolution
 * instead of time-since-creation.
 *
 * @param {string|Date} createdAt - Creation date
 * @param {string|Date} [updatedAt] - Last update date
 * @param {string} [status] - Current status
 * @param {'opportunity'|'suggestion'} [itemType='opportunity'] - Type of item
 * @returns {string} Age bucket: 'fresh', 'acceptable', 'warning',
 *   'overdue', 'critical', or 'unknown'
 */
export function calculateAgeBucket(createdAt, updatedAt = null, status = null, itemType = 'opportunity') {
  const days = calculateAgeDays(createdAt, updatedAt, status, itemType);

  if (days < 0) return 'unknown';
  if (days <= AGE_THRESHOLDS.fresh) return 'fresh';
  if (days <= AGE_THRESHOLDS.acceptable) return 'acceptable';
  if (days <= AGE_THRESHOLDS.warning) return 'warning';
  if (days <= AGE_THRESHOLDS.overdue) return 'overdue';
  return 'critical';
}

/**
 * Group items by status
 * @param {Array} items - Array of items with status property
 * @param {Object} statusEnum - Status enum to use (OPPORTUNITY_STATUS or SUGGESTION_STATUS)
 * @returns {Object} Items grouped by status
 */
export function groupByStatus(items, statusEnum = OPPORTUNITY_STATUS) {
  const groups = {};

  // Initialize groups for all known statuses
  Object.values(statusEnum).forEach((status) => {
    groups[status] = [];
  });
  groups.UNKNOWN = [];

  items.forEach((item) => {
    const status = item.status || 'UNKNOWN';
    if (groups[status]) {
      groups[status].push(item);
    } else {
      groups.UNKNOWN.push(item);
    }
  });

  return groups;
}

/**
 * Group items by age bucket.
 * Uses time-to-resolution for terminal-state items.
 * @param {Array} items - Array of items with createdAt, updatedAt, status properties
 * @param {'opportunity'|'suggestion'} [itemType='opportunity'] - Type of items
 * @returns {Object} Items grouped by age bucket
 */
export function groupByAge(items, itemType = 'opportunity') {
  const groups = {
    fresh: [],
    acceptable: [],
    warning: [],
    overdue: [],
    critical: [],
    unknown: [],
  };

  items.forEach((item) => {
    const bucket = calculateAgeBucket(item.createdAt, item.updatedAt, item.status, itemType);
    groups[bucket].push(item);
  });

  return groups;
}

/**
 * Calculate status counts for opportunities
 * @param {Array} opportunities - Array of opportunity objects
 * @returns {Object} Counts by status
 */
export function calculateStatusCounts(opportunities) {
  const counts = {
    new: 0,
    inProgress: 0,
    resolved: 0,
    ignored: 0,
    total: opportunities.length,
  };

  opportunities.forEach((opp) => {
    const status = opp.status || OPPORTUNITY_STATUS.NEW;
    switch (status) {
      case OPPORTUNITY_STATUS.NEW:
        counts.new++;
        break;
      case OPPORTUNITY_STATUS.IN_PROGRESS:
        counts.inProgress++;
        break;
      case OPPORTUNITY_STATUS.RESOLVED:
        counts.resolved++;
        break;
      case OPPORTUNITY_STATUS.IGNORED:
        counts.ignored++;
        break;
      default:
        counts.new++;
    }
  });

  return counts;
}

/**
 * Calculate age counts for items
 * @param {Array} items - Array of items with createdAt, updatedAt, status properties
 * @param {'opportunity'|'suggestion'} [itemType='opportunity'] - Type of items
 * @returns {Object} Counts by age bucket
 */
export function calculateAgeCounts(items, itemType = 'opportunity') {
  const groups = groupByAge(items, itemType);

  return {
    fresh: groups.fresh.length,
    acceptable: groups.acceptable.length,
    warning: groups.warning.length,
    overdue: groups.overdue.length,
    critical: groups.critical.length,
    unknown: groups.unknown.length,
    // Aging = warning + overdue + critical (items that need attention)
    aging: groups.warning.length + groups.overdue.length + groups.critical.length,
  };
}

/**
 * Aggregate suggestion counts across all opportunities
 * @param {Array} opportunities - Array of opportunities with suggestionsCounts
 * @returns {Object} Aggregated counts
 */
export function aggregateSuggestionsAcrossOpportunities(opportunities) {
  const totals = {
    // Per-status counts
    newCount: 0,
    approvedCount: 0,
    inProgressCount: 0,
    pendingValidationCount: 0,
    fixedCount: 0,
    skippedCount: 0, // SKIPPED — customer chose to skip/ignore
    rejectedRawCount: 0, // REJECTED — ESE flagged as false positive
    errorCount: 0,
    outdatedCount: 0,
    totalCount: 0,
    // Derived totals (recomputed after summing)
    pendingCount: 0,
    awaitingCustomerReviewCount: 0,
    terminalCount: 0,
    opportunitiesWithSuggestions: 0,
    // Fix counts (from /fixes API)
    totalFixes: 0,
    completedFixes: 0,
    failedFixes: 0,
  };

  opportunities.forEach((opp) => {
    const counts = opp.suggestionsCounts || {};
    totals.newCount += counts.newCount || 0;
    totals.approvedCount += counts.approvedCount || 0;
    totals.inProgressCount += counts.inProgressCount || 0;
    totals.pendingValidationCount += counts.pendingValidationCount || 0;
    totals.fixedCount += counts.fixedCount || 0;
    totals.skippedCount += counts.skippedCount || 0;
    totals.rejectedRawCount += counts.rejectedRawCount || 0;
    totals.errorCount += counts.errorCount || 0;
    totals.outdatedCount += counts.outdatedCount || 0;
    totals.totalCount += counts.totalCount || 0;

    // Fix counts
    const fc = opp.fixesCounts || {};
    totals.totalFixes += fc.totalFixes || 0;
    totals.completedFixes += fc.completedFixes || 0;
    totals.failedFixes += fc.failedFixes || 0;

    if ((counts.totalCount || 0) > 0) {
      totals.opportunitiesWithSuggestions++;
    }
  });

  // Derived totals
  totals.pendingCount = totals.newCount
    + totals.approvedCount
    + totals.inProgressCount
    + totals.pendingValidationCount;
  totals.awaitingCustomerReviewCount = totals.newCount
    + totals.approvedCount
    + totals.inProgressCount;

  totals.terminalCount = totals.fixedCount
    + totals.skippedCount
    + totals.rejectedRawCount
    + totals.errorCount
    + totals.outdatedCount;

  return totals;
}

/**
 * Calculate average time to fix/deploy for resolved suggestions
 * @param {Array} opportunities - Array of opportunities with suggestions
 * @returns {number} Average days to fix, or -1 if not calculable
 */
export function calculateAvgTimeToFix(opportunities) {
  let totalDays = 0;
  let fixedCount = 0;

  opportunities.forEach((opp) => {
    const suggestions = opp.suggestions || [];
    suggestions.forEach((sug) => {
      if (sug.status === SUGGESTION_STATUS.FIXED && sug.createdAt && sug.updatedAt) {
        const created = new Date(sug.createdAt);
        const updated = new Date(sug.updatedAt);
        const days = Math.floor((updated - created) / (1000 * 60 * 60 * 24));
        if (days >= 0) {
          totalDays += days;
          fixedCount++;
        }
      }
    });
  });

  return fixedCount > 0 ? Math.round(totalDays / fixedCount) : -1;
}

/**
 * Calculate health score using achievement-based formula
 * @param {Object} statusCounts - Opportunity status counts
 * @param {Object} ageCounts - Age bucket counts
 * @param {Object} options - Additional metrics (avgDaysToFix, suggestionCounts)
 * @param {Object} config - Health configuration
 * @returns {Object} Health score and breakdown
 */
// eslint-disable-next-line max-len
export function calculateHealthScore(statusCounts, ageCounts, options = {}, config = HEALTH_CONFIG) {
  const { weights, targets } = config;
  const { avgDaysToFix = -1, suggestionCounts = {} } = options;

  const oppTotal = statusCounts.total || 1;
  const totalSuggestions = suggestionCounts.totalCount || 0;
  const fixedCount = suggestionCounts.fixedCount || 0;
  const skippedCount = suggestionCounts.skippedCount || 0; // SKIPPED — customer action
  const rejectedRawCount = suggestionCounts.rejectedRawCount || 0; // REJECTED — ESE quality
  const outdatedCount = suggestionCounts.outdatedCount || 0;
  const terminalCount = suggestionCounts.terminalCount || 0;

  const achievements = {};

  // --- 1. Resolution Rate (35%) — FIXED / total suggestions ---
  const resolutionRate = totalSuggestions > 0 ? fixedCount / totalSuggestions : 0;
  const resolutionAchievement = Math.min(1, resolutionRate / targets.resolutionRate);
  achievements.resolutionRate = resolutionAchievement * 100;

  // --- 2. Aging Rate (25%) — aged opportunities / total opportunities ---
  const agingRate = ageCounts.aging / oppTotal;
  // Linear dropoff: 100 at <=10%, 0 at >=30%
  const agingAchievement = agingRate <= targets.maxAgingRate
    ? 1
    : Math.max(0, 1 - (agingRate - targets.maxAgingRate) / 0.2);
  achievements.agingRate = agingAchievement * 100;

  // --- 3. Speed of Resolution (25%) — avg days to FIXED ---
  let timeAchievement;
  if (avgDaysToFix > 0) {
    // Linear penalty: 100 at <=14 days, 0 at >=42 days
    timeAchievement = avgDaysToFix <= targets.avgDaysToFix
      ? 1
      : Math.max(0, 1 - (avgDaysToFix - targets.avgDaysToFix) / 28);
  } else {
    timeAchievement = 0.5; // Neutral if not calculable
  }
  achievements.speedOfResolution = timeAchievement * 100;

  // --- 4. Skip Rate (15%) — customer-skipped / terminal suggestions ---
  const terminalSkipRate = terminalCount > 0
    ? skippedCount / terminalCount
    : 0;
  // Linear penalty: 100 at <=5%, 0 at >=20%
  const skipAchievement = terminalSkipRate <= targets.maxRejectionRate
    ? 1
    : Math.max(0, 1 - (terminalSkipRate - targets.maxRejectionRate) / 0.15);
  achievements.rejectionRate = skipAchievement * 100;

  // Weighted composite
  const score = Math.round(
    achievements.resolutionRate * weights.resolutionRate
    + achievements.agingRate * weights.agingRate
    + achievements.speedOfResolution * weights.speedOfResolution
    + achievements.rejectionRate * weights.rejectionRate,
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    achievements,
    metrics: {
      resolutionRate: parseFloat((resolutionRate * 100).toFixed(1)),
      fixedCount,
      totalSuggestions,
      agingRate: parseFloat((agingRate * 100).toFixed(1)),
      agingCount: ageCounts.aging,
      totalOpportunities: oppTotal,
      avgDaysToFix,
      skipRate: parseFloat((terminalSkipRate * 100).toFixed(1)),
      skippedCount,
      rejectedRawCount,
      outdatedCount,
      terminalCount,
    },
  };
}

/**
 * Calculate comprehensive lifecycle metrics for a site
 * @param {Array} opportunities - Array of enriched opportunities
 * @returns {Object} Complete lifecycle metrics
 */
export function calculateLifecycleMetrics(opportunities) {
  // Calculate status and age counts for opportunities
  const statusCounts = calculateStatusCounts(opportunities);
  const ageCounts = calculateAgeCounts(opportunities);

  // Aggregate suggestion counts
  const suggestionCounts = aggregateSuggestionsAcrossOpportunities(opportunities);

  // Calculate average time to fix
  const avgTimeToFix = calculateAvgTimeToFix(opportunities);

  // Calculate health score
  const health = calculateHealthScore(statusCounts, ageCounts, {
    avgDaysToFix: avgTimeToFix,
    suggestionCounts,
  });

  // Derived rates with 1-decimal precision
  const totalSuggestions = suggestionCounts.totalCount || 0;
  const {
    fixedCount, pendingCount, skippedCount, rejectedRawCount,
    terminalCount, errorCount, outdatedCount,
    newCount, approvedCount, inProgressCount, pendingValidationCount,
  } = suggestionCounts;

  const rate = (numerator) => (totalSuggestions > 0
    ? parseFloat(((numerator / totalSuggestions) * 100).toFixed(1))
    : 0);

  // Fix metrics
  const completedFixes = suggestionCounts.completedFixes || 0;
  const failedFixes = suggestionCounts.failedFixes || 0;
  const totalFixes = suggestionCounts.totalFixes || 0;
  const fixAttempts = completedFixes + failedFixes;
  const autoFixSuccessRate = fixAttempts > 0
    ? parseFloat(((completedFixes / fixAttempts) * 100).toFixed(1))
    : -1; // -1 = not calculable

  return {
    // Opportunity metrics
    opportunities: {
      total: statusCounts.total,
      byStatus: statusCounts,
      byAge: ageCounts,
    },
    // Suggestion metrics
    suggestions: {
      total: totalSuggestions,
      fixedCount,
      pendingCount,
      awaitingCustomerReviewCount: (newCount || 0) + (approvedCount || 0) + (inProgressCount || 0),
      // Pending sub-breakdown
      pendingValidationCount: pendingValidationCount || 0,
      awaitingActionCount: (newCount || 0) + (approvedCount || 0),
      inProgressCount: inProgressCount || 0,
      skippedCount, // SKIPPED — customer chose to skip/ignore
      rejectedRawCount, // REJECTED — ESE flagged as false positive
      errorCount,
      outdatedCount,
      terminalCount,
      resolutionRate: rate(fixedCount),
      skipRate: rate(skippedCount),
      rejectedRate: rate(rejectedRawCount),
      outdatedRate: rate(outdatedCount),
    },
    // Fix metrics (from /fixes API)
    fixes: {
      totalFixes,
      completedFixes,
      failedFixes,
      autoFixSuccessRate,
    },
    // Staleness metrics
    staleness: calculateStalenessMetrics(opportunities),
    // Automation metrics
    automation: calculateAutomationMetrics(opportunities),
    // Lifecycle metrics
    lifecycle: {
      avgTimeToFix,
      agingSuggestions: ageCounts.aging,
      activeOpportunities: statusCounts.new + statusCounts.inProgress,
    },
    // Health score
    health,
    // Timestamp
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Staleness thresholds (days)
 */
export const STALENESS_THRESHOLDS = {
  PENDING_VALIDATION: 7, // PV older than 7 days is stale
  NEW: 14, // NEW older than 14 days is stale
  IN_PROGRESS: 21, // IN_PROGRESS older than 21 days is stale
};

/**
 * Calculate staleness metrics for individual suggestions.
 * Requires opportunities to have a `suggestions` array with createdAt and status.
 *
 * @param {Array} opportunities - enriched opportunities
 * @param {Object} [thresholds] - override STALENESS_THRESHOLDS
 * @returns {{stalePendingValidation, staleNew, staleInProgress, totalStale,
 *            avgTimeToAction, avgTimeToResolution}}
 */
export function calculateStalenessMetrics(opportunities, thresholds = STALENESS_THRESHOLDS) {
  const now = Date.now();
  let stalePV = 0;
  let staleNew = 0;
  let staleIP = 0;

  // Time-to-action: createdAt → first non-NEW/PV status (approx via updatedAt)
  const actionTimes = [];
  // Time-to-resolution: createdAt → terminal status (for terminal items)
  const resTimes = [];

  const TERMINAL = new Set(['FIXED', 'SKIPPED', 'REJECTED', 'ERROR', 'OUTDATED']);

  opportunities.forEach((opp) => {
    (opp.suggestions || []).forEach((sug) => {
      const created = new Date(sug.createdAt || opp.createdAt).getTime();
      const updated = new Date(sug.updatedAt || sug.createdAt || opp.createdAt).getTime();
      const ageDays = Math.floor((now - created) / 86400000);

      if (sug.status === 'PENDING_VALIDATION' && ageDays > thresholds.PENDING_VALIDATION) stalePV++;
      if (sug.status === 'NEW' && ageDays > thresholds.NEW) staleNew++;
      if (sug.status === 'IN_PROGRESS' && ageDays > thresholds.IN_PROGRESS) staleIP++;

      // Time-to-action (only for items that moved past NEW/PV)
      if (sug.status !== 'NEW' && sug.status !== 'PENDING_VALIDATION') {
        const delta = (updated - created) / 86400000;
        if (delta >= 0) actionTimes.push(delta);
      }

      // Time-to-resolution (only terminal)
      if (TERMINAL.has(sug.status)) {
        const delta = (updated - created) / 86400000;
        if (delta >= 0) resTimes.push(delta);
      }
    });

    // Opportunity-level time-to-resolution
    if (opp.status === 'RESOLVED' || opp.status === 'IGNORED') {
      const created = new Date(opp.createdAt).getTime();
      const updated = new Date(opp.updatedAt || opp.createdAt).getTime();
      const delta = (updated - created) / 86400000;
      if (delta >= 0) resTimes.push(delta);
    }
  });

  const avg = (arr) => {
    if (arr.length === 0) return -1;
    return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
  };

  return {
    stalePendingValidation: stalePV,
    staleNew,
    staleInProgress: staleIP,
    totalStale: stalePV + staleNew + staleIP,
    avgTimeToAction: avg(actionTimes),
    avgTimeToResolution: avg(resTimes),
  };
}

/**
 * Calculate automation vs manual fix metrics across all opportunities.
 *
 * @param {Array} opportunities - enriched opportunities (with automationCounts)
 * @returns {{ autoFixedCount, manualFixedCount, automationSuccessRate,
 *             failedFixCount, failuresByType: Object<string, number> }}
 */
export function calculateAutomationMetrics(opportunities) {
  let autoFixed = 0;
  let manual = 0;
  let failed = 0;
  let completed = 0;
  const failuresByType = {};

  opportunities.forEach((opp) => {
    const ac = opp.automationCounts;
    if (ac) {
      autoFixed += ac.autoFixedCount || 0;
      manual += ac.manualFixedCount || 0;
      failed += ac.failedFixCount || 0;
    }
    const fc = opp.fixesCounts;
    if (fc) {
      completed += fc.completedFixes || 0;
    }
    // Group failures by opp type
    if (ac && ac.failedFixCount > 0) {
      const t = opp.type || 'Unknown';
      failuresByType[t] = (failuresByType[t] || 0) + ac.failedFixCount;
    }
  });

  const attempts = completed + failed;
  const automationSuccessRate = attempts > 0
    ? parseFloat(((completed / attempts) * 100).toFixed(1))
    : -1;

  return {
    autoFixedCount: autoFixed,
    manualFixedCount: manual,
    failedFixCount: failed,
    completedFixCount: completed,
    automationSuccessRate,
    failuresByType,
  };
}

/**
 * Get health score label based on score value
 * @param {number} score - Health score (0-100)
 * @returns {string} Label: 'excellent', 'good', 'fair', 'poor', 'critical'
 */
export function getHealthLabel(score) {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  if (score >= 20) return 'poor';
  return 'critical';
}

/**
 * Get color class for health score
 * @param {number} score - Health score (0-100)
 * @returns {string} CSS color class name
 */
export function getHealthColor(score) {
  if (score >= 80) return 'health-excellent';
  if (score >= 60) return 'health-good';
  if (score >= 40) return 'health-fair';
  if (score >= 20) return 'health-poor';
  return 'health-critical';
}

/**
 * Get color class for age bucket
 * @param {string} bucket - Age bucket name
 * @returns {string} CSS color class name
 */
export function getAgeBucketColor(bucket) {
  const colors = {
    fresh: 'age-fresh',
    acceptable: 'age-acceptable',
    warning: 'age-warning',
    overdue: 'age-overdue',
    critical: 'age-critical',
    unknown: 'age-unknown',
  };
  return colors[bucket] || 'age-unknown';
}

/**
 * Format days as human-readable duration
 * @param {number} days - Number of days
 * @returns {string} Formatted duration
 */
export function formatDuration(days) {
  if (days < 0) return 'N/A';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  if (days < 7) return `${days} days`;
  if (days < 30) return `${Math.floor(days / 7)} weeks`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}
