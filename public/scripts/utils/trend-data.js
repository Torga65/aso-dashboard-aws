/**
 * Trend Data Utilities
 *
 * Groups opportunities / suggestions into time-series buckets
 * for use with Chart.js line/bar charts.
 *
 * Date semantics:
 * - Opportunity-level (filter-state.js filterByDateRange): opportunity.createdAt only.
 * - Suggestion-level (here): "created" uses suggestion createdAt; fixed/rejected/skipped/
 *   outdated/error use suggestion updatedAt, with fallback to opportunity updatedAt/createdAt
 *   and API snake_case (updated_at/created_at) when missing.
 */

/**
 * Normalize and attach suggestion dates with opportunity fallbacks for consistent
 * filtering/bucketing. Supports camelCase (createdAt/updatedAt) and snake_case.
 */
export function suggestionWithDates(sug, opp) {
  const createdAt = sug.createdAt ?? sug.created_at ?? opp.createdAt;
  const updatedAt = sug.updatedAt ?? sug.updated_at ?? opp.updatedAt
    ?? sug.createdAt ?? sug.created_at ?? opp.createdAt;
  return {
    ...sug, opportunityType: opp.type, createdAt, updatedAt,
  };
}

/**
 * Group items by time bucket.
 *
 * @param {Array} items — objects with a date field (ISO string)
 * @param {string} dateField — property name to read the date from
 * @param {'day'|'week'} bucketSize
 * @returns {Map<string, Array>} key = ISO date string (bucket start), value = items
 */
export function groupByTimeBucket(items, dateField = 'createdAt', bucketSize = 'day') {
  const buckets = new Map();

  items.forEach((item) => {
    const raw = item[dateField];
    if (!raw) return;
    const d = new Date(raw);
    let key;
    if (bucketSize === 'week') {
      // ISO week start (Monday)
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      key = monday.toISOString().slice(0, 10);
    } else {
      key = d.toISOString().slice(0, 10);
    }
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  });

  return buckets;
}

/**
 * Build a time-series dataset for a specific metric.
 *
 * @param {Array} opportunities — enriched opportunities with suggestions
 * @param {'created'|'fixed'|'rejected'|'error'|'skipped'|'outdated'} metric
 * @param {{ start: Date|null, end: Date|null }} dateRange
 * @param {'day'|'week'} bucket
 * @returns {Array<{date: string, value: number}>} sorted by date
 */
export function buildTrendSeries(opportunities, metric, dateRange = {}, bucket = 'day') {
  // Flatten suggestions with normalized dates (suggestion + opportunity fallback, camel/snake_case)
  const allSuggestions = [];
  opportunities.forEach((opp) => {
    (opp.suggestions || []).forEach((sug) => {
      allSuggestions.push(suggestionWithDates(sug, opp));
    });
  });

  // Choose which date field and filter to use
  let items;
  let dateField;
  switch (metric) {
    case 'created':
      items = allSuggestions;
      dateField = 'createdAt';
      break;
    case 'fixed':
      items = allSuggestions.filter((s) => s.status === 'FIXED');
      dateField = 'updatedAt'; // when they were fixed
      break;
    case 'rejected':
      items = allSuggestions.filter((s) => s.status === 'REJECTED');
      dateField = 'updatedAt';
      break;
    case 'error':
      items = allSuggestions.filter((s) => s.status === 'ERROR');
      dateField = 'updatedAt';
      break;
    case 'skipped':
      items = allSuggestions.filter((s) => s.status === 'SKIPPED');
      dateField = 'updatedAt';
      break;
    case 'outdated':
      items = allSuggestions.filter((s) => s.status === 'OUTDATED');
      dateField = 'updatedAt';
      break;
    case 'pending':
      items = allSuggestions.filter((s) => ['NEW', 'APPROVED', 'IN_PROGRESS', 'PENDING_VALIDATION'].includes(s.status));
      dateField = 'updatedAt';
      break;
    case 'awaiting_customer_review':
      items = allSuggestions.filter((s) => ['NEW', 'APPROVED', 'IN_PROGRESS'].includes(s.status));
      dateField = 'updatedAt';
      break;
    case 'pending_validation':
      items = allSuggestions.filter((s) => s.status === 'PENDING_VALIDATION');
      dateField = 'updatedAt';
      break;
    case 'awaiting_action':
      items = allSuggestions.filter((s) => s.status === 'NEW' || s.status === 'APPROVED');
      dateField = 'updatedAt';
      break;
    case 'in_progress':
      items = allSuggestions.filter((s) => s.status === 'IN_PROGRESS');
      dateField = 'updatedAt';
      break;
    default:
      items = allSuggestions;
      dateField = 'createdAt';
  }

  // Apply date range filter
  if (dateRange.start || dateRange.end) {
    items = items.filter((item) => {
      const raw = item[dateField] || item.createdAt;
      if (raw == null) return false;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return false;
      if (dateRange.start && d < dateRange.start) return false;
      if (dateRange.end && d > dateRange.end) return false;
      return true;
    });
  }

  // Group into buckets
  const buckets = groupByTimeBucket(items, dateField, bucket);

  // Fill in missing days/weeks
  const series = [];
  const sortedKeys = [...buckets.keys()].sort();
  if (sortedKeys.length > 0) {
    let startDate = dateRange.start ? new Date(dateRange.start) : new Date(sortedKeys[0]);
    const lastKey = sortedKeys[sortedKeys.length - 1];
    const endDate = dateRange.end ? new Date(dateRange.end) : new Date(lastKey);
    const stepMs = bucket === 'week' ? 7 * 86400000 : 86400000;

    // For weekly buckets, align start to Monday so keys match groupByTimeBucket
    if (bucket === 'week') {
      const day = startDate.getDay();
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(startDate);
      startDate.setDate(diff);
    }

    for (let d = new Date(startDate); d <= endDate; d = new Date(d.getTime() + stepMs)) {
      const key = d.toISOString().slice(0, 10);
      series.push({ date: key, value: (buckets.get(key) || []).length });
    }
  }

  return series;
}

/**
 * Get total counts per trend metric for a date range.
 * Uses the same filtering as buildTrendSeries so card totals match the chart.
 *
 * @param {Array} opportunities — enriched opportunities with suggestions
 * @param {{ start: Date|null, end: Date|null }} dateRange
 * @returns {{ created, fixed, rejected, skipped, outdated, error, pending, ... }}
 */
export function getTrendTotals(opportunities, dateRange = {}) {
  const metrics = [
    'created', 'fixed', 'rejected', 'skipped', 'outdated', 'error',
    'pending', 'awaiting_customer_review', 'pending_validation',
    'awaiting_action', 'in_progress',
  ];
  const totals = {
    created: 0,
    fixed: 0,
    rejected: 0,
    skipped: 0,
    outdated: 0,
    error: 0,
    pending: 0,
    awaitingCustomerReview: 0,
    pendingValidation: 0,
    awaitingAction: 0,
    inProgress: 0,
  };
  const metricToKey = {
    pending_validation: 'pendingValidation',
    awaiting_customer_review: 'awaitingCustomerReview',
    awaiting_action: 'awaitingAction',
    in_progress: 'inProgress',
  };
  metrics.forEach((metric) => {
    const series = buildTrendSeries(opportunities, metric, dateRange, 'day');
    const sum = series.reduce((s, p) => s + p.value, 0);
    const key = metricToKey[metric] ?? metric;
    totals[key] = sum;
  });
  return totals;
}

/**
 * Count opportunities that had suggestion activity (updatedAt) in the date range.
 *
 * @param {Array} opportunities — enriched opportunities with suggestions
 * @param {{ start: Date|null, end: Date|null }} dateRange
 * @returns {{ total: number, open: number }}
 */
export function getOpportunityCountsInRange(opportunities, dateRange = {}) {
  if (!dateRange.start && !dateRange.end) {
    const total = opportunities.length;
    const open = opportunities.filter((o) => o.status === 'NEW' || o.status === 'IN_PROGRESS').length;
    return { total, open };
  }
  let total = 0;
  let open = 0;
  opportunities.forEach((opp) => {
    const counts = getDateFilteredCounts(opp, dateRange);
    if ((counts.totalCount || 0) > 0) {
      total++;
      if (opp.status === 'NEW' || opp.status === 'IN_PROGRESS') open++;
    }
  });
  return { total, open };
}

/**
 * Compute per-opportunity suggestion counts filtered by date range.
 * All counts use the same rule: suggestion updatedAt in range.
 * So totalCount = sum of status columns (Fixed + Pending + Rejected + etc.).
 *
 * When no range is set (start & end null), returns the original suggestionsCounts unchanged.
 *
 * @param {Object} opp - Enriched opportunity with .suggestions array
 * @param {{ start: Date|null, end: Date|null }} dateRange
 * @returns {Object} Same shape as suggestionsCounts
 */
export function getDateFilteredCounts(opp, dateRange = {}) {
  if (!dateRange.start && !dateRange.end) return opp.suggestionsCounts || {};

  const counts = {
    totalCount: 0,
    fixedCount: 0,
    skippedCount: 0,
    rejectedRawCount: 0,
    errorCount: 0,
    outdatedCount: 0,
    newCount: 0,
    approvedCount: 0,
    inProgressCount: 0,
    pendingValidationCount: 0,
    pendingCount: 0,
    awaitingCustomerReviewCount: 0,
  };

  function inRange(d, start, end) {
    if (!d || Number.isNaN(d.getTime())) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  }

  (opp.suggestions || []).forEach((raw) => {
    const sug = suggestionWithDates(raw, opp);
    const updatedD = new Date(sug.updatedAt);

    if (!inRange(updatedD, dateRange.start, dateRange.end)) return;

    counts.totalCount++;

    switch (sug.status) {
      case 'FIXED': counts.fixedCount++; break;
      case 'SKIPPED': counts.skippedCount++; break;
      case 'REJECTED': counts.rejectedRawCount++; break;
      case 'ERROR': counts.errorCount++; break;
      case 'OUTDATED': counts.outdatedCount++; break;
      case 'APPROVED': counts.approvedCount++; break;
      case 'IN_PROGRESS': counts.inProgressCount++; break;
      case 'PENDING_VALIDATION': counts.pendingValidationCount++; break;
      default: counts.newCount++; break;
    }
  });

  counts.pendingCount = counts.newCount + counts.approvedCount
    + counts.inProgressCount + counts.pendingValidationCount;
  counts.awaitingCustomerReviewCount = counts.newCount + counts.approvedCount
    + counts.inProgressCount;
  return counts;
}

/**
 * Build a per-type breakdown trend.
 *
 * @param {Array} opportunities
 * @param {string} metric
 * @param {Object} dateRange
 * @param {string} bucket
 * @returns {Object<string, Array<{date, value}>>} keyed by opportunity type
 */
export function buildTrendByType(opportunities, metric, dateRange = {}, bucket = 'day') {
  const typeGroups = {};
  opportunities.forEach((opp) => {
    const type = opp.type || 'Unknown';
    if (!typeGroups[type]) typeGroups[type] = [];
    typeGroups[type].push(opp);
  });

  const result = {};
  Object.entries(typeGroups).forEach(([type, opps]) => {
    result[type] = buildTrendSeries(opps, metric, dateRange, bucket);
  });
  return result;
}
