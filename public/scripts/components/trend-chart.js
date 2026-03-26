/**
 * Trend Chart Component
 *
 * Wraps Chart.js for rendering time-series line charts.
 * Lazy-loads Chart.js from CDN on first use.
 */

import { buildTrendSeries, buildTrendByType } from '../utils/trend-data.js';

let Chart = null;
let chartInstance = null;

const CHART_COLORS = [
  '#1473e6', '#28a745', '#ffc107', '#dc3545', '#6c757d',
  '#17a2b8', '#e83e8c', '#fd7e14', '#6610f2', '#20c997',
];

/**
 * Load a script from a URL and return a promise.
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

/**
 * Ensure Chart.js (and optional date adapter) are loaded.
 */
async function loadChartJS() {
  if (Chart) return;
  try {
    if (window.Chart) { Chart = window.Chart; return; }
    await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js');
    Chart = window.Chart;
    // Try loading the date adapter for time-scale support
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js');
      // date adapter loaded — time-scale available
    } catch {
      console.warn('[TrendChart] Date adapter unavailable — using category scale');
    }
  } catch (err) {
    console.error('[TrendChart] Failed to load Chart.js', err);
  }
}

/**
 * Render a trend chart into a container.
 *
 * @param {HTMLElement} container
 * @param {Object} options
 * @param {Array} options.opportunities — enriched opportunities
 * @param {string} options.metric — 'created'|'fixed'|'rejected'|'error'|'skipped'|'outdated'
 * @param {Object} options.dateRange — { start, end }
 * @param {boolean} [options.byType=false] — break down by opportunity type
 */
export async function renderTrendChart(container, {
  opportunities, metric, dateRange, byType = false,
}) {
  await loadChartJS();
  if (!Chart) {
    container.innerHTML = '<p style="color:#999;">Chart library unavailable.</p>';
    return;
  }

  // Auto-detect bucket size based on date range span
  let bucket = 'day';
  if (dateRange.start && dateRange.end) {
    const span = (dateRange.end - dateRange.start) / 86400000;
    if (span > 60) bucket = 'week';
  }

  // Destroy previous chart
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  // Ensure canvas exists
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    container.innerHTML = '';
    canvas = document.createElement('canvas');
    canvas.style.maxHeight = '300px';
    container.appendChild(canvas);
  }

  // Build datasets and collect all labels (dates)
  const datasets = [];
  const allLabels = new Set();

  if (byType) {
    const byTypeData = buildTrendByType(opportunities, metric, dateRange, bucket);
    let colorIdx = 0;
    Object.entries(byTypeData).forEach(([type, series]) => {
      if (series.length === 0) return;
      series.forEach((p) => allLabels.add(p.date));
      datasets.push({
        label: type,
        data: series.map((p) => p.value),
        borderColor: CHART_COLORS[colorIdx % CHART_COLORS.length],
        backgroundColor: `${CHART_COLORS[colorIdx % CHART_COLORS.length]}33`,
        tension: 0.3,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: CHART_COLORS[colorIdx % CHART_COLORS.length],
      });
      colorIdx++;
    });
  } else {
    const series = buildTrendSeries(opportunities, metric, dateRange, bucket);
    series.forEach((p) => allLabels.add(p.date));
    datasets.push({
      label: metric.charAt(0).toUpperCase() + metric.slice(1),
      data: series.map((p) => p.value),
      borderColor: CHART_COLORS[0],
      backgroundColor: `${CHART_COLORS[0]}33`,
      tension: 0.3,
      fill: true,
      pointRadius: 3,
      pointHoverRadius: 5,
      pointBackgroundColor: CHART_COLORS[0],
    });
  }

  const labels = [...allLabels].sort();

  if (labels.length === 0) {
    container.innerHTML = '<p style="color:#999; text-align:center; padding:40px 0;">No trend data available for the selected period.</p>';
    return;
  }

  chartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: byType, position: 'bottom' },
        tooltip: { mode: 'index' },
      },
      scales: {
        x: {
          title: { display: true, text: bucket === 'week' ? 'Week' : 'Day' },
          ticks: {
            maxTicksLimit: 15,
            maxRotation: 45,
          },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Count' },
          ticks: { precision: 0 },
        },
      },
    },
  });
}
