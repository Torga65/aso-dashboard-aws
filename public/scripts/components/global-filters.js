/**
 * Global Filters UI Component
 *
 * Renders a filter bar with date range, customer, and site selectors.
 * Reads/writes shared filter state so all dashboard sections react.
 */

import {
  getFilters,
  setDateRange,
  setCustomer,
  setIncludeLlmoData,
  setIncludeGenericOpportunities,
} from '../state/filter-state.js';

/**
 * Render the global filter bar into a container element.
 *
 * @param {HTMLElement} container - Element to render into
 * @param {Object} options
 * @param {Array}  options.customers - [{ orgId, orgName, sites }]
 * @param {Function} [options.onFilterChange] - Called after any filter change
 */
export function renderGlobalFilters(container, { customers = [], onFilterChange } = {}) {
  const filters = getFilters();

  container.innerHTML = `
    <div class="global-filters">
      <div class="filter-group">
        <label for="gf-date-range">Date Range: <span class="info-bubble" title="How dates are used">?<span class="info-text">Created = when the suggestion was created; Fixed, Rejected, Skipped, etc. = when it was updated to that status.</span></span></label>
        <select id="gf-date-range">
          <option value="7d"  ${filters.dateRange.preset === '7d' ? 'selected' : ''}>Last 7 days</option>
          <option value="30d" ${filters.dateRange.preset === '30d' ? 'selected' : ''}>Last 30 days</option>
          <option value="90d" ${filters.dateRange.preset === '90d' ? 'selected' : ''}>Last 90 days</option>
          <option value="all" ${filters.dateRange.preset === 'all' ? 'selected' : ''}>All time</option>
          <option value="custom" ${filters.dateRange.preset === 'custom' ? 'selected' : ''}>Custom</option>
        </select>
        <input type="date" id="gf-date-from" class="gf-custom-date" value="${filters.dateRange.start ? filters.dateRange.start.toISOString().slice(0, 10) : ''}" style="display:${filters.dateRange.preset === 'custom' ? 'inline-block' : 'none'}"/>
        <input type="date" id="gf-date-to"   class="gf-custom-date" value="${filters.dateRange.end ? filters.dateRange.end.toISOString().slice(0, 10) : ''}" style="display:${filters.dateRange.preset === 'custom' ? 'inline-block' : 'none'}"/>
        <label class="filter-group filter-group-inline" style="margin-left:12px;">
          <input type="checkbox" id="gf-include-llmo" ${filters.includeLlmoData ? 'checked' : ''} />
          Include LLMO Data
        </label>
        <label class="filter-group filter-group-inline" style="margin-left:12px;">
          <input type="checkbox" id="gf-include-generic" ${filters.includeGenericOpportunities ? 'checked' : ''} />
          Include Generic Opportunities
        </label>
      </div>
      ${customers.length > 1 ? `
      <div class="filter-group">
        <label for="gf-customer">Customer:</label>
        <select id="gf-customer">
          <option value="all" ${filters.customerId === 'all' ? 'selected' : ''}>All customers</option>
          ${customers.map((c) => `<option value="${c.orgId}" ${filters.customerId === c.orgId ? 'selected' : ''}>${c.orgName}</option>`).join('')}
        </select>
      </div>
      ` : ''}
    </div>
  `;

  // Wire up events
  const dateSelect = container.querySelector('#gf-date-range');
  const dateFrom = container.querySelector('#gf-date-from');
  const dateTo = container.querySelector('#gf-date-to');
  const customerSel = container.querySelector('#gf-customer');

  dateSelect.addEventListener('change', () => {
    const preset = dateSelect.value;
    dateFrom.style.display = preset === 'custom' ? 'inline-block' : 'none';
    dateTo.style.display = preset === 'custom' ? 'inline-block' : 'none';
    if (preset !== 'custom') {
      setDateRange(preset);
      if (onFilterChange) onFilterChange(getFilters());
    }
  });

  [dateFrom, dateTo].forEach((el) => {
    el.addEventListener('change', () => {
      const from = dateFrom.value ? new Date(dateFrom.value) : null;
      const to = dateTo.value ? new Date(dateTo.value) : null;
      setDateRange('custom', from, to);
      if (onFilterChange) onFilterChange(getFilters());
    });
  });

  if (customerSel) {
    customerSel.addEventListener('change', () => {
      setCustomer(customerSel.value);
      if (onFilterChange) onFilterChange(getFilters());
    });
  }

  const includeLlmoCheckbox = container.querySelector('#gf-include-llmo');
  if (includeLlmoCheckbox) {
    includeLlmoCheckbox.addEventListener('change', () => {
      setIncludeLlmoData(includeLlmoCheckbox.checked);
      if (onFilterChange) onFilterChange(getFilters());
    });
  }

  const includeGenericCheckbox = container.querySelector('#gf-include-generic');
  if (includeGenericCheckbox) {
    includeGenericCheckbox.addEventListener('change', () => {
      setIncludeGenericOpportunities(includeGenericCheckbox.checked);
      if (onFilterChange) onFilterChange(getFilters());
    });
  }
}
