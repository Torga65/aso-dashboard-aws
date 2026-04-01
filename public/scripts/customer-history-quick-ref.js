/**
 * Customer History page: load opportunity audits and signed-in users into quick-ref placeholders.
 * Attaches window.loadCustomerQuickRef(containerElement, customerName).
 * Uses same auth as suggestion-lifecycle: IMS or developer-mode manual token.
 */
/* eslint-disable no-use-before-define, no-underscore-dangle, no-inner-declarations, max-len */

import {
  initIMS,
  getAccessToken,
  signIn,
  signOut,
  isAuthenticated,
  getProfile,
  onAuthStateChange,
} from './auth/imslib-adapter.js';
import { setGlobalToken } from './services/spacecat-api.js';
import { getCustomerQuickRef, updateQuickRefCacheAudits } from './services/customer-quick-ref.js';

/** Session storage key for manual API token (same as suggestion-lifecycle.html) */
const MANUAL_TOKEN_STORAGE_KEY = 'aso_manual_api_token';

let isDevMode = false;

/** Initialize IMS then wire the auth bar. */
(async () => {
  await initIMS();
  initAuthBar();
})();

/**
 * Wire auth bar elements: show/hide state, sign in/out, dev mode, token persistence.
 */
function initAuthBar() {
  const authSignedOut = document.getElementById('auth-signed-out');
  const authSignedIn = document.getElementById('auth-signed-in');
  const authUserName = document.getElementById('auth-user-name');
  const imsSignInBtn = document.getElementById('ims-sign-in-btn');
  const imsSignOutBtn = document.getElementById('ims-sign-out-btn');
  const devModeToggle = document.getElementById('dev-mode-toggle');
  const tokenRow = document.getElementById('token-row');
  const tokenInput = document.getElementById('token-input');
  const tokenToggle = document.getElementById('token-toggle');
  const tokenConnectBtn = document.getElementById('token-connect-btn');

  if (!authSignedOut && !authSignedIn) return;

  function showAuthState() {
    if (isAuthenticated()) {
      if (authSignedOut) authSignedOut.style.display = 'none';
      if (authSignedIn) {
        authSignedIn.style.display = 'flex';
        if (authUserName) {
          const profile = getProfile();
          authUserName.textContent = profile?.email || profile?.name || 'Signed in';
        }
      }
      if (tokenRow) tokenRow.classList.remove('visible');
    } else if (isDevMode && tokenRow) {
      if (authSignedOut) authSignedOut.style.display = 'flex';
      if (authSignedIn) authSignedIn.style.display = 'none';
      tokenRow.classList.add('visible');
    } else {
      if (authSignedOut) authSignedOut.style.display = 'flex';
      if (authSignedIn) authSignedIn.style.display = 'none';
      if (tokenRow) tokenRow.classList.remove('visible');
    }
  }

  if (tokenInput) {
    const saved = localStorage.getItem(MANUAL_TOKEN_STORAGE_KEY);
    if (saved) tokenInput.value = saved;
  }
  if (tokenConnectBtn && tokenInput) {
    tokenConnectBtn.addEventListener('click', () => {
      const v = tokenInput.value.trim();
      if (v) {
        localStorage.setItem(MANUAL_TOKEN_STORAGE_KEY, v);
        setGlobalToken(v);
        window.dispatchEvent(new CustomEvent('customer-quick-ref-token-applied'));
      }
    });
  }
  if (tokenToggle && tokenInput) {
    tokenToggle.addEventListener('click', () => {
      const isPassword = tokenInput.type === 'password';
      tokenInput.type = isPassword ? 'text' : 'password';
      tokenToggle.textContent = isPassword ? 'Hide' : 'Show';
    });
  }
  if (imsSignInBtn) imsSignInBtn.addEventListener('click', () => signIn());
  if (imsSignOutBtn) {
    imsSignOutBtn.addEventListener('click', () => {
      signOut();
      isDevMode = true;
      showAuthState();
    });
  }
  if (devModeToggle) {
    devModeToggle.addEventListener('click', () => {
      isDevMode = true;
      showAuthState();
      if (tokenRow) tokenRow.classList.add('visible');
      if (tokenInput) tokenInput.focus();
    });
  }

  onAuthStateChange(() => showAuthState());
  if (!isAuthenticated() && localStorage.getItem(MANUAL_TOKEN_STORAGE_KEY)) isDevMode = true;
  showAuthState();
}

/** @returns {string|null} IMS token first, then manual token from session. */
function getEffectiveToken() {
  return getAccessToken() || localStorage.getItem(MANUAL_TOKEN_STORAGE_KEY) || null;
}

function escapeHtml(str) {
  if (str == null) return '';
  const s = String(str);
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/**
 * @param {Record<string, number>} loginCountByDay
 * @returns {{ labels: string[], counts: number[], days: string[] }}
 */
function loginCountByDayToChartData(loginCountByDay) {
  const days = [];
  const d = new Date();
  for (let i = 29; i >= 0; i -= 1) {
    const x = new Date(d);
    x.setDate(x.getDate() - i);
    days.push(x.toISOString().slice(0, 10));
  }
  const labels = days.map((day) => {
    const date = new Date(day);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  });
  const counts = days.map((day) => loginCountByDay[day] || 0);
  return { labels, counts, days };
}

/**
 * @param {HTMLElement} container
 * @param {Record<string, number>} loginCountByDay
 * @param {Record<string, string[]>} [usersByDay]
 */
async function renderLoginsChart(container, loginCountByDay, usersByDay = {}) {
  if (!container || !loginCountByDay || Object.keys(loginCountByDay).length === 0) return;
  const existing = container._loginsChartInstance;
  if (existing) {
    existing.destroy();
    container._loginsChartInstance = null;
  }
  if (typeof window.Chart === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.onload = resolve;
      s.onerror = reject;
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
      document.head.appendChild(s);
    }).catch(() => {});
  }
  if (typeof window.Chart === 'undefined') {
    container.innerHTML = '<p style="color:#999; font-size:12px;">Chart.js could not be loaded.</p>';
    return;
  }
  const { labels, counts, days } = loginCountByDayToChartData(loginCountByDay);
  const usersByLabel = days.map((day) => (usersByDay[day] || []));
  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'User sign-ins over the last 30 days');
  container.appendChild(canvas);
  container._loginsChartInstance = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Sign-ins',
        data: counts,
        backgroundColor: 'rgba(20, 115, 230, 0.6)',
        borderColor: '#1473e6',
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y} sign-in${ctx.parsed.y !== 1 ? 's' : ''}`,
            afterBody: (tooltipItems) => {
              const idx = tooltipItems[0]?.dataIndex;
              if (idx == null || !usersByLabel[idx]?.length) return '';
              const list = usersByLabel[idx];
              return `\n${list.map((n) => `• ${n}`).join('\n')}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, maxRotation: 45 } },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: 'Sign-ins' },
        },
      },
    },
  });
}

function wireRefreshButton(container, customerName) {
  const refreshBtn = container.querySelector('.quick-ref-refresh-btn');
  if (!refreshBtn) return;
  refreshBtn.onclick = async () => {
    const auditsEl = container.querySelector('.quick-ref-audits');
    const disabledAuditsEl = container.querySelector('.quick-ref-disabled-audits');
    const pendingEl = container.querySelector('.quick-ref-pending');
    const usersEl = container.querySelector('.quick-ref-users');
    if (auditsEl) auditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (disabledAuditsEl) disabledAuditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (pendingEl) pendingEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (usersEl) usersEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    delete container.dataset.autofixEditMode;
    const siteSelect = container.querySelector('.quick-ref-site-select');
    const siteId = siteSelect?.value || undefined;
    await loadCustomerQuickRef(container, customerName, { forceRefresh: true, siteId: siteId || undefined });
  };
}

function renderSiteDropdown(container, customerName, sites, currentSiteId) {
  const actionsEl = container.querySelector('.quick-ref-actions');
  if (!actionsEl) return;
  const prevLabel = container.querySelector('.quick-ref-site-label');
  const prevSelect = container.querySelector('.quick-ref-site-select');
  if (prevLabel) prevLabel.remove();
  if (prevSelect) prevSelect.remove();
  if (!sites || sites.length <= 1) return;
  const label = document.createElement('label');
  label.htmlFor = 'quick-ref-site-select';
  label.className = 'quick-ref-site-label';
  label.textContent = 'Site:';
  const select = document.createElement('select');
  select.id = 'quick-ref-site-select';
  select.className = 'quick-ref-site-select';
  select.setAttribute('aria-label', 'Select site to display');
  sites.forEach((s) => {
    const opt = document.createElement('option');
    const sid = s.siteId || '';
    opt.value = sid;
    const labelText = (s.baseURL || sid || 'Site').replace(/^https?:\/\//, '').replace(/\/$/, '') || `Site ${sid}`;
    opt.textContent = labelText;
    if (sid === (currentSiteId || '')) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    const auditsEl = container.querySelector('.quick-ref-audits');
    const disabledAuditsEl = container.querySelector('.quick-ref-disabled-audits');
    const pendingEl = container.querySelector('.quick-ref-pending');
    const usersEl = container.querySelector('.quick-ref-users');
    if (auditsEl) auditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (disabledAuditsEl) disabledAuditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (pendingEl) pendingEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    if (usersEl) usersEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    loadCustomerQuickRef(container, customerName, { siteId: select.value || undefined });
  });
  actionsEl.insertBefore(label, actionsEl.firstChild);
  actionsEl.insertBefore(select, actionsEl.firstChild);
}

function wireUserRowClicks(usersEl, container) {
  usersEl.addEventListener('click', (e) => {
    const row = e.target.closest('tr.qr-user-row');
    if (!row) return;

    const nextRow = row.nextElementSibling;
    if (nextRow && nextRow.classList.contains('qr-user-detail')) {
      nextRow.remove();
      row.classList.remove('expanded');
      return;
    }

    usersEl.querySelectorAll('.qr-user-detail').forEach((r) => r.remove());
    usersEl.querySelectorAll('.qr-user-row.expanded').forEach((r) => r.classList.remove('expanded'));
    row.classList.add('expanded');

    const { userName } = row.dataset;
    const usersByDay = container._quickRefUsersByDay || {};

    const days = [];
    const today = new Date();
    for (let i = 29; i >= 0; i -= 1) {
      const x = new Date(today);
      x.setDate(x.getDate() - i);
      days.push(x.toISOString().slice(0, 10));
    }

    const loginDays = days.filter((day) => (usersByDay[day] || []).includes(userName));
    const loginCount = loginDays.length;
    const dateList = loginDays.length > 0
      ? loginDays.map((day) => {
        const d = new Date(day);
        return `<li>${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</li>`;
      }).join('')
      : '<li style="color:#999;">No logins recorded</li>';

    const detailRow = document.createElement('tr');
    detailRow.className = 'qr-user-detail';
    detailRow.innerHTML = `<td colspan="2"><span class="qr-user-history-label">${loginCount} login${loginCount !== 1 ? 's' : ''} in last 30 days</span><ul class="qr-user-login-dates">${dateList}</ul></td>`;
    row.after(detailRow);
  });
}

function setDetailsCount(detailsEl, count) {
  if (!detailsEl) return;
  const summary = detailsEl.querySelector(':scope > summary');
  if (!summary) return;
  let badge = summary.querySelector('.qr-summary-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'qr-summary-count';
    summary.appendChild(badge);
  }
  badge.textContent = count > 0 ? String(count) : '0';
}

function showAutofixEditButtons(container, showEdit, showSaveCancel) {
  const editBtn = container.querySelector('.quick-ref-edit-autofix-btn');
  const saveBtn = container.querySelector('.quick-ref-save-autofix-btn');
  const cancelBtn = container.querySelector('.quick-ref-cancel-autofix-btn');
  if (editBtn) editBtn.style.display = showEdit ? '' : 'none';
  if (saveBtn) saveBtn.style.display = showSaveCancel ? '' : 'none';
  if (cancelBtn) cancelBtn.style.display = showSaveCancel ? '' : 'none';
}

function buildAutofixHeaderHtml(hasEditableAudits) {
  if (!hasEditableAudits) return '<th>Auto-fix</th>';
  return '<th class="quick-ref-autofix-th"><span>Auto-fix</span><div class="quick-ref-autofix-header"><button type="button" class="quick-ref-edit-autofix-btn">Edit</button><button type="button" class="quick-ref-save-autofix-btn" style="display:none;">Save</button><button type="button" class="quick-ref-cancel-autofix-btn" style="display:none;">Cancel</button></div></th>';
}

function renderAuditsSectionOnly(container, customerName, forceViewMode = false) {
  const auditsEl = container.querySelector('.quick-ref-audits');
  const audits = container._quickRefAudits;
  const baseURL = container._quickRefBaseURL;
  const token = getEffectiveToken();
  const editMode = forceViewMode ? false : (container.dataset.autofixEditMode === 'true');
  if (!auditsEl || !Array.isArray(audits) || audits.length === 0) return;
  const canEditAutoFix = Boolean(baseURL && token);
  const hasEditableAudits = canEditAutoFix && audits.some((r) => r.auditType);
  const rows = audits.map((r) => {
    const autoFixValue = r.autoFix === 'Yes' || r.autoFix === 'No' ? r.autoFix : 'No';
    const autoFixCell = editMode && canEditAutoFix && r.auditType
      ? `<td><select class="quick-ref-autofix-select" data-audit-type="${escapeHtml(r.auditType)}" aria-label="Auto-fix for ${escapeHtml(r.opportunity)}">
          <option value="Yes" ${autoFixValue === 'Yes' ? 'selected' : ''}>Yes</option>
          <option value="No" ${autoFixValue === 'No' ? 'selected' : ''}>No</option>
        </select></td>`
      : `<td>${r.autoFix === 'Yes' ? '<span class="quick-ref-autofix-yes">Yes</span>' : escapeHtml(r.autoFix)}</td>`;
    return `<tr><td>${escapeHtml(r.opportunity)}</td><td>${escapeHtml(r.lastRun)}</td>${autoFixCell}</tr>`;
  });
  const autofixTh = buildAutofixHeaderHtml(hasEditableAudits);
  auditsEl.innerHTML = `<table class="quick-ref-table" role="table"><thead><tr><th>Audit</th><th>Last run</th>${autofixTh}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  setDetailsCount(auditsEl.closest('details'), audits.length);
  showAutofixEditButtons(container, hasEditableAudits && !editMode, editMode);
  if (hasEditableAudits) wireAutofixEditButtons(container, customerName);
}

function wireAutofixEditButtons(container, customerName) {
  const editBtn = container.querySelector('.quick-ref-edit-autofix-btn');
  const saveBtn = container.querySelector('.quick-ref-save-autofix-btn');
  const cancelBtn = container.querySelector('.quick-ref-cancel-autofix-btn');
  if (editBtn) {
    editBtn.onclick = () => {
      container.dataset.autofixEditMode = 'true';
      renderAuditsSectionOnly(container, customerName);
    };
  }
  if (saveBtn) {
    saveBtn.onclick = () => {
      const selects = container.querySelectorAll('.quick-ref-autofix-select');
      const audits = container._quickRefAudits;
      if (Array.isArray(audits)) {
        Array.from(selects).forEach((select) => {
          const { auditType } = select.dataset;
          const value = select.value === 'Yes' ? 'Yes' : 'No';
          const row = audits.find((r) => r.auditType === auditType);
          if (row) row.autoFix = value;
        });
        updateQuickRefCacheAudits(customerName, audits);
      }
      const errMsg = container.querySelector('.quick-ref-autofix-err');
      if (errMsg) errMsg.remove();
      delete container.dataset.autofixEditMode;
      renderAuditsSectionOnly(container, customerName, true);
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      delete container.dataset.autofixEditMode;
      renderAuditsSectionOnly(container, customerName);
    };
  }
}

async function loadCustomerQuickRef(container, customerName, options = {}) {
  if (!container || !customerName) return;
  const auditsEl = container.querySelector('.quick-ref-audits');
  const disabledAuditsEl = container.querySelector('.quick-ref-disabled-audits');
  const pendingEl = container.querySelector('.quick-ref-pending');
  const usersEl = container.querySelector('.quick-ref-users');
  if (!auditsEl && !disabledAuditsEl && !pendingEl && !usersEl) return;

  const token = getEffectiveToken();
  if (!token) {
    if (auditsEl) auditsEl.innerHTML = '<p class="quick-ref-msg">Sign in to load enabled audits.</p>';
    if (disabledAuditsEl) disabledAuditsEl.innerHTML = '<p class="quick-ref-msg">Sign in to load disabled audits.</p>';
    if (pendingEl) pendingEl.innerHTML = '<p class="quick-ref-msg">Sign in to load pending validation.</p>';
    if (usersEl) usersEl.innerHTML = '<p class="quick-ref-msg">Sign in to load users signed in.</p>';
    return;
  }
  setGlobalToken(token);

  if (auditsEl) auditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
  if (disabledAuditsEl) disabledAuditsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
  if (pendingEl) pendingEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
  if (usersEl) usersEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';

  try {
    const result = await getCustomerQuickRef(customerName, token, options);
    const {
      orgResolved, audits = [], disabledAudits = [], pendingValidationOpps = { count: 0, types: [] }, users = [], loginCountByDay = {}, usersByDay = {}, sites = [], siteId: currentSiteId, allOrgs, baseURL,
    } = result;

    if (!orgResolved && allOrgs && allOrgs.length > 0) {
      const pickerHtml = `
        <p class="quick-ref-msg">No automatic match for this customer. Type to search and select the SpaceCat organization:</p>
        <div class="quick-ref-org-picker">
          <div class="searchable-wrap">
            <input type="text" class="quick-ref-org-input" data-quickref-customer="${escapeHtml(customerName)}" placeholder="Type to search organization…" autocomplete="off" aria-label="SpaceCat organization"/>
            <ul class="searchable-dropdown" role="listbox" aria-label="Organization results"></ul>
          </div>
        </div>
      `;
      if (auditsEl) auditsEl.innerHTML = pickerHtml;
      if (disabledAuditsEl) disabledAuditsEl.innerHTML = '';
      if (usersEl) usersEl.innerHTML = '';
      const input = container.querySelector('.quick-ref-org-input');
      const dropdown = container.querySelector('.quick-ref-org-picker .searchable-dropdown');
      if (input && dropdown) {
        function showDropdown() {
          const q = (input.value || '').trim().toLowerCase();
          const filtered = q
            ? allOrgs.filter((o) => (o.orgName || '').toLowerCase().includes(q))
            : allOrgs;
          dropdown.innerHTML = filtered.length
            ? filtered.map((o) => `<li role="option" data-org-id="${escapeHtml(o.orgId)}" data-org-name="${escapeHtml(o.orgName || '')}">${escapeHtml(o.orgName || '')}</li>`).join('')
            : '<li data-empty>No matching organization</li>';
          dropdown.classList.add('show');
          dropdown.querySelectorAll('li:not([data-empty])').forEach((li) => {
            li.addEventListener('click', () => {
              const orgId = li.dataset.orgId || '';
              const orgName = (li.dataset.orgName || '').trim();
              input.value = orgName;
              input.dataset.orgId = orgId;
              dropdown.classList.remove('show');
              if (orgId) {
                // Persist mapping so future loads skip manual selection
                fetch('/api/org-mapping', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ companyName: customerName, spacecatOrgId: orgId }),
                }).catch(() => { /* non-critical */ });
                loadCustomerQuickRef(container, customerName, { orgId });
              }
            });
          });
        }
        input.addEventListener('focus', showDropdown);
        input.addEventListener('input', showDropdown);
        input.addEventListener('blur', () => {
          setTimeout(() => dropdown.classList.remove('show'), 200);
        });
      }
      wireRefreshButton(container, customerName);
      return;
    }

    if (!orgResolved) {
      const msg = '<p class="quick-ref-msg">No organization found. Sign in with a valid token and ensure SpaceCat returns organizations, or select a customer that has been mapped before.</p>';
      if (auditsEl) auditsEl.innerHTML = msg;
      if (disabledAuditsEl) disabledAuditsEl.innerHTML = msg;
      if (usersEl) usersEl.innerHTML = msg;
      wireRefreshButton(container, customerName);
      return;
    }

    if (disabledAuditsEl) {
      if (disabledAudits.length === 0) {
        disabledAuditsEl.innerHTML = '<p class="quick-ref-msg">No disabled audits for this site.</p>';
      } else {
        const items = disabledAudits
          .map((t) => {
            const type = (typeof t === 'string' ? t : t?.auditType) || '';
            return `<li>${escapeHtml(type.replace(/-/g, ' '))}</li>`;
          })
          .join('');
        disabledAuditsEl.innerHTML = `<ul class="quick-ref-list" style="margin:0;padding-left:18px;">${items}</ul>`;
      }
      setDetailsCount(disabledAuditsEl.closest('details'), disabledAudits.length);
    }

    if (pendingEl) {
      const pvCount = pendingValidationOpps.count || 0;
      const pvTypes = Array.isArray(pendingValidationOpps.types) ? pendingValidationOpps.types : [];
      const backOfficeLink = currentSiteId
        ? `<a class="quick-ref-backoffice-link" href="https://experience.adobe.com/#/@sitesinternal/custom-apps/245265-EssDeveloperUI/#/sites/${encodeURIComponent(currentSiteId)}/opportunities?showPendingValidation=true" target="_blank" rel="noopener noreferrer">Open in back office</a>`
        : '';
      if (pvCount === 0) {
        pendingEl.innerHTML = `<p class="quick-ref-msg">No pending validation suggestions.</p>${backOfficeLink}`;
      } else {
        const typeItems = pvTypes
          .map((t) => `<li>${escapeHtml((t || '').replace(/-/g, ' '))}</li>`)
          .join('');
        pendingEl.innerHTML = `
          <div class="quick-ref-pv-count">${pvCount}</div>
          <p class="quick-ref-pv-label">suggestion${pvCount !== 1 ? 's' : ''} awaiting validation</p>
          ${pvTypes.length > 0 ? `<ul class="quick-ref-list" style="margin:6px 0 0;padding-left:18px;">${typeItems}</ul>` : ''}
          ${backOfficeLink}
        `;
      }
      setDetailsCount(pendingEl.closest('details'), pvCount);
    }

    if (auditsEl) {
      if (audits.length === 0) {
        auditsEl.innerHTML = '<p class="quick-ref-msg">No audit config for this customer.</p>';
        setDetailsCount(auditsEl.closest('details'), 0);
        showAutofixEditButtons(container, false, false);
      } else {
        container._quickRefAudits = audits;
        container._quickRefBaseURL = baseURL ?? null;
        container._quickRefSiteId = currentSiteId ?? null;
        if (options.editMode !== true && options.editMode !== false) {
          // preserve existing edit mode across refreshes
        } else {
          container.dataset.autofixEditMode = options.editMode === true ? 'true' : '';
        }
        renderAuditsSectionOnly(container, customerName);
      }
    }

    if (usersEl) {
      if (users.length === 0 && Object.keys(loginCountByDay).length === 0) {
        usersEl.innerHTML = '<p class="quick-ref-msg">No sign-in data for this customer.</p>';
        setDetailsCount(usersEl.closest('details'), 0);
      } else {
        let tableHtml = '';
        if (users.length > 0) {
          const now = Date.now();
          const list = users
            .slice(0, 20)
            .map((u) => {
              const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.emailId || '—';
              const diffDays = u.lastSignInAt
                ? Math.floor((now - new Date(u.lastSignInAt).getTime()) / 86400000)
                : null;
              let daysLabel;
              if (diffDays === null) daysLabel = '—';
              else if (diffDays === 0) daysLabel = 'Today';
              else if (diffDays === 1) daysLabel = '1 day ago';
              else daysLabel = `${diffDays} days ago`;
              let daysClass;
              if (diffDays === null) daysClass = '';
              else if (diffDays <= 7) daysClass = 'qr-days-recent';
              else if (diffDays <= 14) daysClass = 'qr-days-warn';
              else daysClass = 'qr-days-stale';
              const emailTitle = u.emailId ? ` title="${escapeHtml(u.emailId)}"` : '';
              return `<tr class="qr-user-row" data-user-name="${escapeHtml(name)}"><td${emailTitle}>${escapeHtml(name)}</td><td class="${daysClass}">${escapeHtml(daysLabel)}</td></tr>`;
            });
          const more = users.length > 20 ? `<tr><td colspan="2" class="quick-ref-more">+ ${users.length - 20} more</td></tr>` : '';
          tableHtml = `<table class="quick-ref-table" role="table"><thead><tr><th>User</th><th>Last login</th></tr></thead><tbody>${list.join('')}${more}</tbody></table>`;
        }
        const hasChartData = loginCountByDay && Object.keys(loginCountByDay).length > 0;
        const chartWrapHtml = hasChartData
          ? '<div class="quick-ref-logins-chart-wrap"><p class="quick-ref-logins-chart-title">Logins last 30 days</p><div class="quick-ref-logins-chart-container"></div></div>'
          : '';
        container._quickRefUsersByDay = usersByDay;
        usersEl.innerHTML = tableHtml + chartWrapHtml;
        setDetailsCount(usersEl.closest('details'), users.length);
        if (users.length > 0) wireUserRowClicks(usersEl, container);
        if (hasChartData) {
          const chartContainer = usersEl.querySelector('.quick-ref-logins-chart-container');
          if (chartContainer) await renderLoginsChart(chartContainer, loginCountByDay, usersByDay);
        }
      }
    }

    renderSiteDropdown(container, customerName, sites, currentSiteId);

    // Load ServiceNow comments (independent of SpaceCat — fetched from our own DB)
    loadCustomerComments(container, customerName);
    loadCustomerTranscripts(container, customerName);
    loadCustomerNotes(container, customerName);

    // Load progression stage widget (no auth required — API key)
    if (window.loadCustomerProgression) window.loadCustomerProgression(container, customerName);

    wireRefreshButton(container, customerName);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[QuickRef]', err);
    if (auditsEl) auditsEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load audits.</p>';
    if (disabledAuditsEl) disabledAuditsEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load.</p>';
    if (usersEl) usersEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load users.</p>';
    showAutofixEditButtons(container, false, false);
    wireRefreshButton(container, customerName);
  }
}

/**
 * Load and render ServiceNow comments for a customer.
 * Wires the time-range selector to re-fetch on change.
 */
async function loadCustomerComments(container, customerName) {
  const commentsEl = container.querySelector('.quick-ref-comments');
  const rangeSelect = container.querySelector('.quick-ref-comments-range');
  const claudeBtn = container.querySelector('.qr-comments-claude-btn');
  if (!commentsEl) return;

  async function fetchAndRender(days) {
    commentsEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    try {
      const params = new URLSearchParams({ company: customerName, days: String(days) });
      const res = await fetch(`/api/comments?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const comments = data || [];

      // Update count badge on summary
      const summary = commentsEl.closest('details')?.querySelector('summary');
      const badge = summary?.querySelector('.qr-summary-count');
      if (badge) badge.textContent = comments.length > 0 ? `(${comments.length})` : '';

      if (comments.length === 0) {
        commentsEl.innerHTML = '<p class="quick-ref-msg">No comments in this period.</p>';
        return;
      }

      commentsEl.innerHTML = comments.map((c) => {
        const dateLabel = c.commentDate || '';
        const author = c.author ? escapeHtml(c.author) : '';
        const body = c.body ? escapeHtml(c.body) : '';
        return `
          <div class="qr-comment-entry">
            <div class="qr-comment-meta">
              <strong>${dateLabel}</strong>${author ? ` &mdash; ${author}` : ''}
            </div>
            <div class="qr-comment-body">${body}</div>
          </div>`;
      }).join('');
    } catch (err) {
      commentsEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load comments.</p>';
    }
  }

  await fetchAndRender(rangeSelect?.value ?? '30');

  if (rangeSelect) {
    rangeSelect.addEventListener('change', () => fetchAndRender(rangeSelect.value));
  }

  if (claudeBtn) {
    claudeBtn.addEventListener('click', async () => {
      const days = rangeSelect?.value ?? 'latest';
      const orig = claudeBtn.textContent;
      claudeBtn.textContent = 'Fetching…';
      claudeBtn.disabled = true;
      try {
        const params = new URLSearchParams({ company: customerName, days });
        const res = await fetch(`/api/comments?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        const comments = data || [];
        if (comments.length === 0) throw new Error('No comments in this range.');
        const rangeLabel = days === 'latest' ? 'the most recent' : days === 'all' ? 'all' : `the last ${days} days of`;
        const body = comments.map((c) => `[${c.commentDate}]${c.author ? ` ${c.author}` : ''}\n${c.body}`).join('\n\n---\n\n');
        const prompt = `Below are ${rangeLabel} ServiceNow comments for ${customerName}. Please summarize the key themes, customer concerns, action items, and overall sentiment.\n\n${body}`;
        await navigator.clipboard.writeText(prompt);
        claudeBtn.textContent = 'Copied!';
        setTimeout(() => { claudeBtn.textContent = orig; claudeBtn.disabled = false; }, 2000);
      } catch (err) {
        claudeBtn.textContent = err.message || 'Failed';
        setTimeout(() => { claudeBtn.textContent = orig; claudeBtn.disabled = false; }, 3000);
      }
    });
  }
}

/**
 * Wire the Meeting Transcripts panel for a customer.
 * Handles upload, list, and download.
 */
async function loadCustomerTranscripts(container, customerName) {
  const listEl = container.querySelector('.qr-transcript-list');
  const rangeSelect = container.querySelector('.qr-transcript-range');
  const uploadBtn = container.querySelector('.qr-transcript-upload-btn');
  const statusEl = container.querySelector('.qr-transcript-upload-status');
  const fileInput = container.querySelector('.qr-transcript-file');
  const dateInput = container.querySelector('.qr-transcript-date');
  const downloadBtns = container.querySelectorAll('.qr-transcript-download-btn');
  const claudeRangeBtn = container.querySelector('.qr-transcript-claude-range');

  if (!listEl) return;

  // Default date input to today
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  async function fetchAndRenderList() {
    if (!listEl) return;
    listEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    try {
      const days = rangeSelect?.value ?? '30';
      const params = new URLSearchParams({ company: customerName, days });
      const res = await fetch(`/api/transcripts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const items = data || [];

      // Update count badge
      const summary = listEl.closest('details')?.querySelector('summary');
      const badge = summary?.querySelector('.qr-summary-count');
      if (badge) badge.textContent = items.length > 0 ? `(${items.length})` : '';

      if (items.length === 0) {
        listEl.innerHTML = '<p class="quick-ref-msg">No meeting files in this period.</p>';
        return;
      }

      listEl.innerHTML = items.map((item) => {
        const byLabel = item.uploadedBy ? ` · ${escapeHtml(item.uploadedBy)}` : '';
        const dlUrl = `/api/transcripts/download?company=${encodeURIComponent(customerName)}&id=${encodeURIComponent(item.id)}`;
        const viewUrl = `${dlUrl}&view=1`;
        return `
          <div class="qr-transcript-item">
            <span class="qr-transcript-item-date">${escapeHtml(item.meetingDate)}</span>
            <span class="qr-transcript-item-name" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName)}${byLabel}</span>
            <a class="qr-transcript-item-dl" href="${dlUrl}" download="${escapeHtml(item.fileName)}">Download</a>
            <button class="qr-transcript-claude-btn" data-view-url="${viewUrl}" data-date="${escapeHtml(item.meetingDate)}">Copy AI prompt</button>
          </div>`;
      }).join('');

      // Wire per-item Claude link copy buttons
      listEl.querySelectorAll('.qr-transcript-claude-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const viewUrl = btn.dataset.viewUrl;
          const date = btn.dataset.date;
          const orig = btn.textContent;
          btn.textContent = 'Fetching…';
          btn.disabled = true;
          try {
            const res = await fetch(viewUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const content = await res.text();
            const prompt = `Please analyze this meeting transcript for ${customerName} (${date}):\n\n${content}`;
            await navigator.clipboard.writeText(prompt);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
          } catch (err) {
            btn.textContent = 'Failed';
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
          }
        });
      });
    } catch (err) {
      listEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load files.</p>';
    }
  }

  // Wire range selector
  if (rangeSelect) {
    rangeSelect.addEventListener('change', fetchAndRenderList);
  }

  // Wire download buttons
  downloadBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = rangeSelect?.value ?? '30';
      const url = `/api/transcripts/download?company=${encodeURIComponent(customerName)}&days=${days}`;
      const a = document.createElement('a');
      a.href = url;
      a.click();
    });
  });

  // Wire range-level AI prompt button — fetches all transcripts in range and embeds inline
  if (claudeRangeBtn) {
    claudeRangeBtn.addEventListener('click', async () => {
      const days = rangeSelect?.value ?? 'all';
      const viewUrl = `/api/transcripts/download?company=${encodeURIComponent(customerName)}&days=${days}&view=1`;
      const orig = claudeRangeBtn.textContent;
      claudeRangeBtn.textContent = 'Fetching…';
      claudeRangeBtn.disabled = true;
      try {
        const res = await fetch(viewUrl);
        if (!res.ok) throw new Error(res.status === 404 ? 'No transcripts in this range.' : `HTTP ${res.status}`);
        const content = await res.text();
        const rangeLabel = days === 'all' ? 'all available meetings' : `the last ${days} days of meetings`;
        const prompt = `Please analyze the meeting transcripts for ${customerName} covering ${rangeLabel}. Provide a summary of key topics discussed, action items, attendees, and any customer concerns or feedback.\n\n${content}`;
        await navigator.clipboard.writeText(prompt);
        claudeRangeBtn.textContent = 'Copied!';
        setTimeout(() => { claudeRangeBtn.textContent = orig; claudeRangeBtn.disabled = false; }, 2000);
      } catch (err) {
        claudeRangeBtn.textContent = err.message || 'Failed';
        setTimeout(() => { claudeRangeBtn.textContent = orig; claudeRangeBtn.disabled = false; }, 3000);
      }
    });
  }

  // Wire upload button
  if (uploadBtn && fileInput && dateInput) {
    uploadBtn.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      const date = dateInput.value;

      if (!file) { if (statusEl) { statusEl.textContent = 'Select a VTT file first.'; statusEl.className = 'qr-transcript-upload-status err'; } return; }
      if (!date) { if (statusEl) { statusEl.textContent = 'Select a meeting date.'; statusEl.className = 'qr-transcript-upload-status err'; } return; }

      uploadBtn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Uploading…'; statusEl.className = 'qr-transcript-upload-status'; }

      try {
        // Get current user info from IMS profile if available
        const profile = typeof getProfile === 'function' ? getProfile() : null;
        const uploadedBy = profile?.email || profile?.name || '';

        const form = new FormData();
        form.append('company', customerName);
        form.append('meetingDate', date);
        form.append('uploadedBy', uploadedBy);
        form.append('file', file);

        const res = await fetch('/api/transcripts', { method: 'POST', body: form });
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }

        if (statusEl) { statusEl.textContent = `Uploaded: ${file.name}`; statusEl.className = 'qr-transcript-upload-status ok'; }
        fileInput.value = '';
        await fetchAndRenderList();
      } catch (err) {
        if (statusEl) { statusEl.textContent = `Upload failed: ${err.message}`; statusEl.className = 'qr-transcript-upload-status err'; }
      } finally {
        uploadBtn.disabled = false;
      }
    });
  }

  await fetchAndRenderList();
}

/**
 * Wire the Meeting Notes panel for a customer.
 * Notes are stored via the same /api/transcripts endpoint with fileType="notes".
 * Supports typing/pasting text directly OR uploading a .txt/.md file.
 */
async function loadCustomerNotes(container, customerName) {
  const listEl      = container.querySelector('.qr-notes-list');
  const rangeSelect = container.querySelector('.qr-notes-range');
  const uploadBtn   = container.querySelector('.qr-notes-upload-btn');
  const statusEl    = container.querySelector('.qr-notes-upload-status');
  const fileInput   = container.querySelector('.qr-notes-file');
  const dateInput   = container.querySelector('.qr-notes-date');
  const titleInput  = container.querySelector('.qr-notes-title');
  const textarea    = container.querySelector('.qr-notes-textarea');
  const aiRangeBtn  = container.querySelector('.qr-notes-ai-range');
  const countBadge  = container.querySelector('.qr-notes-count');
  if (!listEl) return;

  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  async function fetchAndRenderList() {
    listEl.innerHTML = '<p class="quick-ref-msg">Loading…</p>';
    try {
      const days = rangeSelect?.value ?? 'all';
      const params = new URLSearchParams({ company: customerName, days });
      const res = await fetch(`/api/transcripts?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { data } = await res.json();
      const items = (data || []).filter(i => i.fileType === 'notes');

      if (countBadge) countBadge.textContent = items.length > 0 ? `(${items.length})` : '';

      if (items.length === 0) {
        listEl.innerHTML = '<p class="quick-ref-msg">No meeting notes in this period.</p>';
        return;
      }

      listEl.innerHTML = items.map(item => {
        const byLabel = item.uploadedBy ? `<span class="qr-notes-item-by">· ${escapeHtml(item.uploadedBy)}</span>` : '';
        const viewUrl = `/api/transcripts/download?company=${encodeURIComponent(customerName)}&id=${encodeURIComponent(item.id)}&view=1`;
        return `
          <div class="qr-notes-item" data-id="${escapeHtml(item.id)}" data-view-url="${viewUrl}" data-date="${escapeHtml(item.meetingDate)}">
            <div class="qr-notes-item-header">
              <span class="qr-notes-item-date">${escapeHtml(item.meetingDate)}</span>
              <span class="qr-notes-item-title" title="${escapeHtml(item.fileName)}">${escapeHtml(item.fileName.replace(/\.txt$|\.md$/i, ''))}</span>
              ${byLabel}
              <div class="qr-notes-item-actions">
                <button class="qr-notes-ai-btn" data-view-url="${viewUrl}" data-date="${escapeHtml(item.meetingDate)}">Copy AI prompt</button>
              </div>
            </div>
          </div>`;
      }).join('');

      // Wire per-item AI buttons
      listEl.querySelectorAll('.qr-notes-ai-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const viewUrl = btn.dataset.viewUrl;
          const date = btn.dataset.date;
          const orig = btn.textContent;
          btn.textContent = 'Fetching…'; btn.disabled = true;
          try {
            const r = await fetch(viewUrl);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const content = await r.text();
            const prompt = `Please analyze these meeting notes for ${customerName} (${date}) and summarize key discussion points, decisions, action items, and any customer concerns:\n\n${content}`;
            await navigator.clipboard.writeText(prompt);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
          } catch {
            btn.textContent = 'Failed';
            setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
          }
        });
      });
    } catch {
      listEl.innerHTML = '<p class="quick-ref-msg quick-ref-err">Failed to load notes.</p>';
    }
  }

  if (rangeSelect) rangeSelect.addEventListener('change', fetchAndRenderList);

  // Range AI prompt
  if (aiRangeBtn) {
    aiRangeBtn.addEventListener('click', async () => {
      const days = rangeSelect?.value ?? 'all';
      const orig = aiRangeBtn.textContent;
      aiRangeBtn.textContent = 'Fetching…'; aiRangeBtn.disabled = true;
      try {
        const params = new URLSearchParams({ company: customerName, days });
        const res = await fetch(`/api/transcripts?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { data } = await res.json();
        const items = (data || []).filter(i => i.fileType === 'notes');
        if (items.length === 0) throw new Error('No notes in this range.');

        // Fetch content for each note
        const contents = await Promise.all(items.map(async item => {
          const viewUrl = `/api/transcripts/download?company=${encodeURIComponent(customerName)}&id=${encodeURIComponent(item.id)}&view=1`;
          const r = await fetch(viewUrl);
          const text = r.ok ? await r.text() : '';
          return `[${item.meetingDate}] ${item.fileName.replace(/\.txt$|\.md$/i, '')}\n${text}`;
        }));

        const rangeLabel = days === 'all' ? 'all available' : `last ${days} days of`;
        const prompt = `Please analyze the following ${rangeLabel} meeting notes for ${customerName}. Provide a summary of key themes, decisions, action items, and any recurring customer concerns:\n\n${contents.join('\n\n---\n\n')}`;
        await navigator.clipboard.writeText(prompt);
        aiRangeBtn.textContent = 'Copied!';
        setTimeout(() => { aiRangeBtn.textContent = orig; aiRangeBtn.disabled = false; }, 2000);
      } catch (err) {
        aiRangeBtn.textContent = err.message || 'Failed';
        setTimeout(() => { aiRangeBtn.textContent = orig; aiRangeBtn.disabled = false; }, 3000);
      }
    });
  }

  // Upload / save
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      const date  = dateInput?.value;
      const title = titleInput?.value.trim();
      const text  = textarea?.value.trim();
      const file  = fileInput?.files?.[0];

      if (!date) { if (statusEl) { statusEl.textContent = 'Select a meeting date.'; statusEl.className = 'qr-notes-upload-status err'; } return; }
      if (!text && !file) { if (statusEl) { statusEl.textContent = 'Enter notes or choose a file.'; statusEl.className = 'qr-notes-upload-status err'; } return; }

      uploadBtn.disabled = true;
      if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.className = 'qr-notes-upload-status'; }

      try {
        const profile = typeof getProfile === 'function' ? getProfile() : null;
        const uploadedBy = profile?.email || profile?.name || '';

        let uploadFile;
        if (file) {
          uploadFile = file;
        } else {
          // Wrap typed text as a .txt file named after the title or date
          const filename = `${(title || date).replace(/[^a-z0-9\-_ ]/gi, '_')}.txt`;
          uploadFile = new File([text], filename, { type: 'text/plain' });
        }

        const form = new FormData();
        form.append('company', customerName);
        form.append('meetingDate', date);
        form.append('fileType', 'notes');
        form.append('uploadedBy', uploadedBy);
        // Use title as filename if provided
        const finalFilename = title
          ? `${title.replace(/[^a-z0-9\-_ ]/gi, '_')}.txt`
          : uploadFile.name;
        form.append('file', uploadFile, finalFilename);

        const res = await fetch('/api/transcripts', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

        if (statusEl) { statusEl.textContent = 'Saved!'; statusEl.className = 'qr-notes-upload-status ok'; }
        if (textarea) textarea.value = '';
        if (titleInput) titleInput.value = '';
        if (fileInput) fileInput.value = '';
        await fetchAndRenderList();
      } catch (err) {
        if (statusEl) { statusEl.textContent = `Failed: ${err.message}`; statusEl.className = 'qr-notes-upload-status err'; }
      } finally {
        uploadBtn.disabled = false;
      }
    });

    // Auto-populate textarea when file is selected
    if (fileInput) {
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const text = await file.text();
        if (textarea) textarea.value = text;
        if (titleInput && !titleInput.value) titleInput.value = file.name.replace(/\.[^.]+$/, '');
      });
    }
  }

  await fetchAndRenderList();
}

if (typeof window !== 'undefined') {
  window.loadCustomerQuickRef = loadCustomerQuickRef;
}
