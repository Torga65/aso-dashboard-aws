/**
 * ASO Dashboard MCP Server
 *
 * Exposes customer data from the ASO Dashboard as Claude tools:
 *   - get_transcripts      — full meeting history + notes (no date window; always all records)
 *   - get_comments         — ServiceNow comments for a customer
 *   - get_customer_data    — latest snapshot + health data for a customer
 *   - list_customers       — list all customers (optionally filtered by status)
 *   - search_customers     — full-text search across customer fields
 *   - list_headless_customers — customers marked headless (custom field / deployment type)
 *
 * Assistant convention: for any customer-specific answer (status, engagement, summary),
 * also call get_transcripts and get_comments for that company unless the user declines.
 *
 * Requires the Next.js app to be running (defaults to http://localhost:3000).
 * Override with: ASO_BASE_URL=https://your-deployed-app.com node server.mjs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = process.env.ASO_BASE_URL ?? 'http://localhost:3000';

/* ─── helpers ─────────────────────────────────────────────────────────── */

async function apiFetch(path) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error ${res.status} for ${url}: ${body}`);
  }
  return res;
}

function formatDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

/* ─── server ──────────────────────────────────────────────────────────── */

const server = new McpServer({
  name: 'aso-dashboard',
  version: '1.0.0',
});

/* ── 1. get_transcripts ─────────────────────────────────────────────── */
server.tool(
  'get_transcripts',
  'Fetch ALL meeting transcripts and uploaded notes for a customer (full history). Each file includes a NOTE header with date, type, filename, and description/tags. Returns combined text. Use alongside get_comments and get_customer_data for a complete picture. Call list_notes first to preview available files and their descriptions before downloading everything.',
  {
    company: z.string().describe('Customer / company name (exact match used in the dashboard)'),
  },
  async ({ company }) => {
    const qs = new URLSearchParams({ company, days: 'all', view: '1' });
    const res = await apiFetch(`/api/transcripts/download?${qs}`);
    const content = await res.text();

    if (!content.trim()) {
      return { content: [{ type: 'text', text: `No transcripts found for "${company}".` }] };
    }

    const lineCount = content.split('\n').length;
    return {
      content: [{
        type: 'text',
        text: `Meeting transcripts and notes for ${company} (full history) — ${lineCount} lines:\n\n${content}`,
      }],
    };
  }
);

/* ── 1b. list_notes ─────────────────────────────────────────────────── */
server.tool(
  'list_notes',
  'List meeting notes and transcripts for a customer showing metadata only (date, filename, description/tags, type, uploader) — no content downloaded. Use this first to understand what is available and find relevant files by description before calling get_transcripts for full content.',
  {
    company:   z.string().describe('Customer / company name'),
    fileType:  z.enum(['all', 'notes', 'transcript']).default('all').describe('"notes" for meeting notes, "transcript" for VTT transcripts, "all" for both'),
    query:     z.string().optional().describe('Optional keyword to filter by — matches against filename and description'),
  },
  async ({ company, fileType, query }) => {
    const qs = new URLSearchParams({ company, days: 'all' });
    const res = await apiFetch(`/api/transcripts?${qs}`);
    const { data } = await res.json();
    let items = data ?? [];

    if (fileType !== 'all') items = items.filter((i) => i.fileType === fileType);
    if (query) {
      const needle = query.toLowerCase();
      items = items.filter((i) =>
        (i.fileName || '').toLowerCase().includes(needle) ||
        (i.description || '').toLowerCase().includes(needle)
      );
    }

    if (items.length === 0) {
      const scope = fileType !== 'all' ? fileType : 'files';
      return { content: [{ type: 'text', text: `No ${scope} found for "${company}"${query ? ` matching "${query}"` : ''}.` }] };
    }

    items.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));
    const lines = items.map((i) => {
      const parts = [`• [${i.meetingDate}] ${i.fileName} (${i.fileType})`];
      if (i.description) parts.push(`  Description: ${i.description}`);
      if (i.uploadedBy)  parts.push(`  Uploaded by: ${i.uploadedBy}`);
      return parts.join('\n');
    });

    return {
      content: [{
        type: 'text',
        text: `${items.length} file${items.length !== 1 ? 's' : ''} for ${company}${query ? ` matching "${query}"` : ''}:\n\n${lines.join('\n\n')}`,
      }],
    };
  }
);

/* ── 2. get_comments ────────────────────────────────────────────────── */
server.tool(
  'get_comments',
  'Fetch ServiceNow comments for a customer. Comments are written by the ESE / CSM team and capture customer conversations, status updates, and action items.',
  {
    company:  z.string().describe('Customer / company name'),
    days:     z.enum(['latest', '30', '60', '90', 'all']).default('all').describe('Date range. "latest" returns only the most recent comment.'),
  },
  async ({ company, days }) => {
    const qs = new URLSearchParams({ company, days });
    const res = await apiFetch(`/api/comments?${qs}`);
    const { data } = await res.json();
    const comments = data ?? [];

    if (comments.length === 0) {
      return { content: [{ type: 'text', text: `No comments found for "${company}" in the requested range.` }] };
    }

    const formatted = comments.map((c) =>
      `[${c.commentDate}]${c.author ? ` ${c.author}` : ''}\n${c.body}`
    ).join('\n\n---\n\n');

    return {
      content: [{
        type: 'text',
        text: `ServiceNow comments for ${company} (${comments.length} entries, ${days === 'all' ? 'all time' : days === 'latest' ? 'latest only' : `last ${days} days`}):\n\n${formatted}`,
      }],
    };
  }
);

/* ── 3. get_customer_data ───────────────────────────────────────────── */
server.tool(
  'get_customer_data',
  'Fetch the latest snapshot data for a specific customer: status, engagement, blockers, feedback, license type, ESE lead, and more. For a complete picture, also call get_transcripts and get_comments with the same company name.',
  {
    company: z.string().describe('Customer / company name'),
  },
  async ({ company }) => {
    const res = await apiFetch('/api/customers');
    const { data } = await res.json();
    const all = data ?? [];

    // Find all snapshots for this company (case-insensitive)
    const needle = company.toLowerCase();
    const matches = all.filter((r) => (r.companyName || '').toLowerCase().includes(needle));

    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No customer found matching "${company}". Try list_customers to see available names.` }] };
    }

    // Get latest snapshot per matched company
    const byCompany = new Map();
    matches.forEach((r) => {
      const existing = byCompany.get(r.companyName);
      if (!existing || r.week > existing.week) byCompany.set(r.companyName, r);
    });

    const rows = [...byCompany.values()].map((r) => {
      const fields = [
        `Company: ${r.companyName}`,
        `Week: ${r.week}`,
        `Status: ${r.status || '—'}`,
        `Engagement: ${r.engagement || '—'}`,
        `License Type: ${r.licenseType || '—'}`,
        `Industry: ${r.industry || '—'}`,
        `ESE Lead: ${r.eseLead || '—'}`,
        `Deployment Type: ${r.deploymentType || '—'}`,
        `MAU: ${r.mau || '—'}`,
        `TTIV: ${r.ttiv || '—'}`,
        r.blockers ? `Blockers: ${r.blockers}` : null,
        r.feedback ? `Feedback: ${r.feedback}` : null,
        r.summary  ? `Summary: ${r.summary}` : null,
        `Last Updated: ${formatDate(r.lastUpdated)}`,
      ].filter(Boolean);
      return fields.join('\n');
    });

    return {
      content: [{
        type: 'text',
        text: rows.join('\n\n══════════════════════════\n\n'),
      }],
    };
  }
);

/* ── 4. list_customers ──────────────────────────────────────────────── */
server.tool(
  'list_customers',
  'List all customers in the dashboard with their current status and engagement. Optionally filter by status. When drilling into one customer, use get_transcripts and get_comments for full context.',
  {
    status:     z.enum(['', 'Active', 'At-Risk', 'Onboarding', 'Pre-Production', 'Churned', 'On-Hold']).default('').describe('Filter by status, or leave empty for all.'),
    engagement: z.enum(['', 'High', 'Medium', 'Low', 'Unknown']).default('').describe('Filter by engagement level.'),
  },
  async ({ status, engagement }) => {
    const res = await apiFetch('/api/customers');
    const { data } = await res.json();
    const all = data ?? [];

    // Latest snapshot per customer
    const byCompany = new Map();
    all.forEach((r) => {
      const existing = byCompany.get(r.companyName);
      if (!existing || r.week > existing.week) byCompany.set(r.companyName, r);
    });

    let customers = [...byCompany.values()];
    if (status)     customers = customers.filter((c) => c.status === status);
    if (engagement) customers = customers.filter((c) => c.engagement === engagement);

    customers.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

    if (customers.length === 0) {
      return { content: [{ type: 'text', text: 'No customers match the requested filters.' }] };
    }

    const lines = customers.map((c) =>
      `• ${c.companyName} | ${c.status || '—'} | ${c.engagement || '—'} | ESE: ${c.eseLead || '—'}`
    );

    return {
      content: [{
        type: 'text',
        text: `${customers.length} customer${customers.length !== 1 ? 's' : ''}${status ? ` (${status})` : ''}${engagement ? ` / ${engagement} engagement` : ''}:\n\n${lines.join('\n')}`,
      }],
    };
  }
);

/* ── 5. search_customers ────────────────────────────────────────────── */
server.tool(
  'search_customers',
  'Full-text search across all customer fields (company name, blockers, feedback, summary, ESE lead, industry). Returns matching customers with their latest snapshot. When summarizing a match, also call get_transcripts and get_comments for that company.',
  {
    query: z.string().describe('Search term — matches against any text field'),
  },
  async ({ query }) => {
    const res = await apiFetch('/api/customers');
    const { data } = await res.json();
    const all = data ?? [];

    const needle = query.toLowerCase();
    const TEXT_FIELDS = ['companyName', 'blockers', 'feedback', 'summary', 'eseLead', 'industry', 'licenseType', 'status', 'deploymentType'];

    function rowSearchBlob(r) {
      const parts = TEXT_FIELDS.map((f) => String(r[f] || ''));
      const cf = r.customFields;
      if (cf && typeof cf === 'object') {
        for (const [k, v] of Object.entries(cf)) {
          parts.push(k);
          const val = typeof v === 'object' && v !== null && 'value' in v ? v.value : v;
          parts.push(String(val));
        }
      }
      return parts.join(' ').toLowerCase();
    }

    const byCompany = new Map();
    all.forEach((r) => {
      const existing = byCompany.get(r.companyName);
      if (!existing || r.week > existing.week) byCompany.set(r.companyName, r);
    });

    const matches = [...byCompany.values()].filter((r) => rowSearchBlob(r).includes(needle));

    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No customers found matching "${query}".` }] };
    }

    const rows = matches.map((r) => {
      const matchedFields = TEXT_FIELDS
        .filter((f) => (String(r[f] || '')).toLowerCase().includes(needle))
        .map((f) => `  ${f}: ${r[f]}`);
      const cf = r.customFields;
      const matchedCf = [];
      if (cf && typeof cf === 'object') {
        for (const [k, v] of Object.entries(cf)) {
          const val = typeof v === 'object' && v !== null && 'value' in v ? v.value : v;
          const blob = `${k} ${val}`.toLowerCase();
          if (blob.includes(needle)) matchedCf.push(`  customFields.${k}: ${val}`);
        }
      }
      const matched = [...matchedFields, ...matchedCf].join('\n');
      return `${r.companyName} (${r.status || '—'}):\n${matched}`;
    });

    return {
      content: [{
        type: 'text',
        text: `${matches.length} match${matches.length !== 1 ? 'es' : ''} for "${query}":\n\n${rows.join('\n\n')}`,
      }],
    };
  }
);

/* ── 6. list_headless_customers ─────────────────────────────────────── */
server.tool(
  'list_headless_customers',
  'List customers whose latest snapshot is marked headless: deploymentType contains "headless" and/or customFields.headless is true/yes. Uses GET /api/reports/headless-customers.',
  {},
  async () => {
    const res = await apiFetch('/api/reports/headless-customers');
    const json = await res.json();
    const list = json.customers ?? [];
    if (list.length === 0) {
      return { content: [{ type: 'text', text: 'No headless customers found (latest snapshot per company).' }] };
    }
    const lines = list.map(
      (c) =>
        `• ${c.companyName} | ${c.status || '—'} | ${c.licenseType || '—'} | deployment: ${c.deploymentType || '—'} | ESE: ${c.eseLead || '—'} | week: ${c.week || '—'}`
    );
    return {
      content: [{
        type: 'text',
        text: `${json.count} headless customer${json.count !== 1 ? 's' : ''} (latest snapshot):\n\n${lines.join('\n')}\n\n${json.definition || ''}`,
      }],
    };
  }
);

/* ── 7. get_progression ─────────────────────────────────────────────── */
server.tool(
  'get_progression',
  'Get the current migration/onboarding progression record for a specific customer: track (Moving/On Hold/Done/Stopped), stage, migration source, checklist completion, notes, and history. Returns null if the customer has no progression entry.',
  {
    company: z.string().describe('Customer / company name (exact match used in the dashboard)'),
  },
  async ({ company }) => {
    const qs = new URLSearchParams({ company });
    const res = await apiFetch(`/api/progression?${qs}`);
    const { data } = await res.json();

    if (!data) {
      return { content: [{ type: 'text', text: `No progression record found for "${company}".` }] };
    }

    const p = data;
    const lines = [
      `Company: ${p.companyName}`,
      `Track: ${p.progressionTrack}`,
      `Stage: ${p.progressionStage}`,
      p.migrationSource ? `Migration Source: ${p.migrationSource}` : null,
      p.stageEnteredAt  ? `Stage Entered: ${formatDate(p.stageEnteredAt)}` : null,
      p.updatedBy       ? `Last Updated By: ${p.updatedBy}` : null,
      p.updatedAt       ? `Last Updated At: ${formatDate(p.updatedAt)}` : null,
      p.notes           ? `Notes: ${p.notes}` : null,
      // On Hold / Future Date fields
      p.projectedGoLiveDate ? `Projected Go-Live: ${formatDate(p.projectedGoLiveDate)}` : null,
      p.holdReason          ? `Hold Reason: ${p.holdReason}` : null,
      p.holdReasonOther     ? `Hold Reason (Other): ${p.holdReasonOther}` : null,
      // Preprod checklist
      p.preprodOnboardFirstSite    != null ? `Preprod — Onboard First Site: ${p.preprodOnboardFirstSite ? 'Yes' : 'No'}` : null,
      p.preprodFcmCompleted        != null ? `Preprod — FCM Completed: ${p.preprodFcmCompleted ? 'Yes' : 'No'}` : null,
      p.preprodPreflightCompleted  != null ? `Preprod — Pre-flight Completed: ${p.preprodPreflightCompleted ? 'Yes' : 'No'}` : null,
      // Prod checklist
      p.prodAutoOptimizeEnabled       != null ? `Prod — Auto-Optimize Enabled: ${p.prodAutoOptimizeEnabled ? 'Yes' : 'No'}` : null,
      p.prodAutoOptimizedOpportunity  != null ? `Prod — Auto-Optimized Opportunity Deployed: ${p.prodAutoOptimizedOpportunity ? 'Yes' : 'No'}` : null,
    ].filter(Boolean);

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

/* ── 8. list_progression ────────────────────────────────────────────── */
server.tool(
  'list_progression',
  'List all customers in the migration/onboarding pipeline with their current track and stage. Optionally filter by track or stage. Use get_progression for full detail on a specific customer.',
  {
    track: z.enum(['', 'Moving', 'On Hold', 'Done', 'Stopped']).default('').describe('Filter by track, or leave empty for all.'),
    stage: z.string().default('').describe('Filter by stage name (partial match, case-insensitive), e.g. "Preprod", "Prod", "Future Date".'),
  },
  async ({ track, stage }) => {
    const res = await apiFetch('/api/progression/all');
    const { data } = await res.json();
    let items = data ?? [];

    if (track) items = items.filter((p) => p.progressionTrack === track);
    if (stage) {
      const needle = stage.toLowerCase();
      items = items.filter((p) => (p.progressionStage || '').toLowerCase().includes(needle));
    }

    items.sort((a, b) => (a.companyName || '').localeCompare(b.companyName || ''));

    if (items.length === 0) {
      return { content: [{ type: 'text', text: 'No progression records match the requested filters.' }] };
    }

    const lines = items.map((p) => {
      let line = `• ${p.companyName} | ${p.progressionTrack} / ${p.progressionStage}`;
      if (p.migrationSource) line += ` | ${p.migrationSource}`;
      if (p.stageEnteredAt)  line += ` | since ${formatDate(p.stageEnteredAt)}`;
      return line;
    });

    return {
      content: [{
        type: 'text',
        text: `${items.length} record${items.length !== 1 ? 's' : ''}${track ? ` (${track})` : ''}${stage ? ` / stage contains "${stage}"` : ''}:\n\n${lines.join('\n')}`,
      }],
    };
  }
);

/* ── 9. get_stage_history ───────────────────────────────────────────── */
server.tool(
  'get_stage_history',
  'Get the full stage-change audit trail for a customer — every time their progression track or stage was updated, who made the change, and any notes or checklist state captured at the time.',
  {
    company: z.string().describe('Customer / company name (exact match used in the dashboard)'),
  },
  async ({ company }) => {
    const qs = new URLSearchParams({ company });
    const res = await apiFetch(`/api/progression/history?${qs}`);
    const { data } = await res.json();
    const entries = data ?? [];

    if (entries.length === 0) {
      return { content: [{ type: 'text', text: `No stage history found for "${company}".` }] };
    }

    const formatted = entries.map((e) => {
      const lines = [
        `[${formatDate(e.changedAt)}] ${e.progressionTrack} / ${e.progressionStage}`,
        e.changedBy       ? `  Changed by: ${e.changedBy}` : null,
        e.migrationSource ? `  Migration source: ${e.migrationSource}` : null,
        e.notes           ? `  Notes: ${e.notes}` : null,
        e.projectedGoLiveDate ? `  Projected go-live: ${formatDate(e.projectedGoLiveDate)}` : null,
        e.holdReason          ? `  Hold reason: ${e.holdReason}${e.holdReasonOther ? ` — ${e.holdReasonOther}` : ''}` : null,
        (e.preprodOnboardFirstSite != null || e.preprodFcmCompleted != null || e.preprodPreflightCompleted != null)
          ? `  Preprod checklist: onboard=${e.preprodOnboardFirstSite ? '✓' : '✗'} FCM=${e.preprodFcmCompleted ? '✓' : '✗'} pre-flight=${e.preprodPreflightCompleted ? '✓' : '✗'}`
          : null,
        (e.prodAutoOptimizeEnabled != null || e.prodAutoOptimizedOpportunity != null)
          ? `  Prod checklist: auto-optimize=${e.prodAutoOptimizeEnabled ? '✓' : '✗'} opp-deployed=${e.prodAutoOptimizedOpportunity ? '✓' : '✗'}`
          : null,
      ].filter(Boolean);
      return lines.join('\n');
    });

    return {
      content: [{
        type: 'text',
        text: `Stage history for ${company} (${entries.length} entries, newest first):\n\n${formatted.join('\n\n')}`,
      }],
    };
  }
);

/* ─── start ───────────────────────────────────────────────────────────── */
const transport = new StdioServerTransport();
await server.connect(transport);
