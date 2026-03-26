/**
 * Global Filter State — singleton pub/sub module
 *
 * All dashboard components subscribe to filter changes.
 * Filters are synced to URL search params for shareability.
 */

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const _listeners = new Set();

const _state = {
  dateRange: {
    preset: '30d', // '7d' | '30d' | '90d' | 'all' | 'custom'
    start: null, // Date | null  (set when preset or custom)
    end: null, // Date | null
  },
  customerId: 'all', // orgId string or 'all'
  siteId: 'all', // siteId string or 'all'
  includeLlmoData: false, // when false, exclude LLMO-only opportunities
  includeGenericOpportunities: false, // when false, exclude type === 'generic-opportunity'
};

/* ------------------------------------------------------------------ */
/*  Preset helpers                                                     */
/* ------------------------------------------------------------------ */

function presetToDates(preset) {
  const end = new Date();
  let start = null;
  switch (preset) {
    case '7d': start = new Date(end - 7 * 86400000); break;
    case '30d': start = new Date(end - 30 * 86400000); break;
    case '90d': start = new Date(end - 90 * 86400000); break;
    case 'all': start = null; break;
    default: start = null; // custom handled externally
  }
  return { start, end: preset === 'all' ? null : end };
}

// Initialize date range from preset
(() => {
  const { start, end } = presetToDates(_state.dateRange.preset);
  _state.dateRange.start = start;
  _state.dateRange.end = end;
})();

/* ------------------------------------------------------------------ */
/*  URL sync                                                           */
/* ------------------------------------------------------------------ */

function writeToURL() {
  const params = new URLSearchParams(window.location.search);
  params.set('range', _state.dateRange.preset);
  if (_state.customerId !== 'all') params.set('customer', _state.customerId); else params.delete('customer');
  if (_state.siteId !== 'all') params.set('site', _state.siteId); else params.delete('site');
  if (_state.includeLlmoData) params.set('llmo', '1'); else params.delete('llmo');
  if (_state.includeGenericOpportunities) params.set('generic', '1'); else params.delete('generic');
  if (_state.dateRange.preset === 'custom' && _state.dateRange.start) {
    params.set('from', _state.dateRange.start.toISOString().slice(0, 10));
  } else {
    params.delete('from');
  }
  if (_state.dateRange.preset === 'custom' && _state.dateRange.end) {
    params.set('to', _state.dateRange.end.toISOString().slice(0, 10));
  } else {
    params.delete('to');
  }
  const qs = params.toString();
  const newUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
  window.history.replaceState(null, '', newUrl);
}

function readFromURL() {
  const params = new URLSearchParams(window.location.search);
  const preset = params.get('range') || '30d';
  _state.dateRange.preset = preset;
  if (preset === 'custom') {
    _state.dateRange.start = params.get('from') ? new Date(params.get('from')) : null;
    _state.dateRange.end = params.get('to') ? new Date(params.get('to')) : null;
  } else {
    const { start, end } = presetToDates(preset);
    _state.dateRange.start = start;
    _state.dateRange.end = end;
  }
  _state.customerId = params.get('customer') || 'all';
  _state.siteId = params.get('site') || 'all';
  _state.includeLlmoData = params.get('llmo') === '1';
  _state.includeGenericOpportunities = params.get('generic') === '1';
}

// Hydrate from URL on module load
readFromURL();

/* ------------------------------------------------------------------ */
/*  Notify                                                             */
/* ------------------------------------------------------------------ */

function notify() {
  writeToURL();
  const snapshot = getFilters();
  _listeners.forEach((fn) => {
    try { fn(snapshot); } catch (e) {
      // eslint-disable-next-line no-console -- intentional: isolate listener errors
      console.error('[FilterState] listener error', e);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * @returns {{ dateRange, customerId, siteId, includeLlmoData, includeGenericOpportunities }}
 *   Immutable snapshot of current filters.
 */
export function getFilters() {
  return {
    dateRange: { ..._state.dateRange },
    customerId: _state.customerId,
    siteId: _state.siteId,
    includeLlmoData: _state.includeLlmoData,
    includeGenericOpportunities: _state.includeGenericOpportunities,
  };
}

export function setIncludeLlmoData(value) {
  _state.includeLlmoData = Boolean(value);
  notify();
}

export function setIncludeGenericOpportunities(value) {
  _state.includeGenericOpportunities = Boolean(value);
  notify();
}

export function setDateRange(preset, customStart = null, customEnd = null) {
  _state.dateRange.preset = preset;
  if (preset === 'custom') {
    _state.dateRange.start = customStart;
    _state.dateRange.end = customEnd;
  } else {
    const { start, end } = presetToDates(preset);
    _state.dateRange.start = start;
    _state.dateRange.end = end;
  }
  notify();
}

export function setCustomer(orgId) {
  _state.customerId = orgId || 'all';
  notify();
}

export function setSite(siteId) {
  _state.siteId = siteId || 'all';
  notify();
}

/**
 * Subscribe to filter changes.
 * @param {Function} fn - Receives a filters snapshot
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/**
 * Filter an array of items by the current date range.
 * Uses item.createdAt only (opportunity-level filtering: "created in range").
 * For suggestion-level counts by state (e.g. rejected in range), use getTrendTotals
 * in trend-data.js instead.
 *
 * @param {Array} items - e.g. opportunities; must have createdAt (ISO string or Date)
 * @returns {Array}
 */
export function filterByDateRange(items) {
  const { start, end } = _state.dateRange;
  if (!start && !end) return items;
  return items.filter((item) => {
    const d = new Date(item.createdAt);
    if (Number.isNaN(d.getTime())) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
  });
}
