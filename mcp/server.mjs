/**
 * ASO Dashboard MCP Server
 *
 * Exposes customer data from the ASO Dashboard as Claude tools:
 *   - get_transcripts      — meeting VTT transcripts for a customer
 *   - get_comments         — ServiceNow comments for a customer
 *   - get_customer_data    — latest snapshot + health data for a customer
 *   - list_customers       — list all customers (optionally filtered by status)
 *   - search_customers     — full-text search across customer fields
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
  'Fetch meeting transcripts for a customer. Returns the full VTT content of all meetings in the requested date range, combined into a single document.',
  {
    company:  z.string().describe('Customer / company name (exact match used in the dashboard)'),
    days:     z.enum(['30', '60', '90', 'all']).default('all').describe('Date range to fetch. Use "all" for everything.'),
  },
  async ({ company, days }) => {
    const qs = new URLSearchParams({ company, days, view: '1' });
    const res = await apiFetch(`/api/transcripts/download?${qs}`);
    const content = await res.text();

    if (!content.trim()) {
      return { content: [{ type: 'text', text: `No transcripts found for "${company}".` }] };
    }

    const lineCount = content.split('\n').length;
    return {
      content: [{
        type: 'text',
        text: `Meeting transcripts for ${company} (${days === 'all' ? 'all time' : `last ${days} days`}) — ${lineCount} lines:\n\n${content}`,
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
  'Fetch the latest snapshot data for a specific customer: status, engagement, health score, blockers, feedback, license type, ESE lead, and more.',
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
        `Health Score: ${r.healthScore ?? '—'}`,
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
  'List all customers in the dashboard with their current status, engagement, and health score. Optionally filter by status.',
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
      `• ${c.companyName} | ${c.status || '—'} | ${c.engagement || '—'} | Health: ${c.healthScore ?? '—'} | ESE: ${c.eseLead || '—'}`
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
  'Full-text search across all customer fields (company name, blockers, feedback, summary, ESE lead, industry). Returns matching customers with their latest snapshot.',
  {
    query: z.string().describe('Search term — matches against any text field'),
  },
  async ({ query }) => {
    const res = await apiFetch('/api/customers');
    const { data } = await res.json();
    const all = data ?? [];

    const needle = query.toLowerCase();
    const TEXT_FIELDS = ['companyName', 'blockers', 'feedback', 'summary', 'eseLead', 'industry', 'licenseType', 'status'];

    const byCompany = new Map();
    all.forEach((r) => {
      const existing = byCompany.get(r.companyName);
      if (!existing || r.week > existing.week) byCompany.set(r.companyName, r);
    });

    const matches = [...byCompany.values()].filter((r) =>
      TEXT_FIELDS.some((f) => (r[f] || '').toLowerCase().includes(needle))
    );

    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No customers found matching "${query}".` }] };
    }

    const rows = matches.map((r) => {
      const matched = TEXT_FIELDS
        .filter((f) => (r[f] || '').toLowerCase().includes(needle))
        .map((f) => `  ${f}: ${r[f]}`).join('\n');
      return `${r.companyName} (${r.status || '—'}, health ${r.healthScore ?? '—'}):\n${matched}`;
    });

    return {
      content: [{
        type: 'text',
        text: `${matches.length} match${matches.length !== 1 ? 'es' : ''} for "${query}":\n\n${rows.join('\n\n')}`,
      }],
    };
  }
);

/* ─── start ───────────────────────────────────────────────────────────── */
const transport = new StdioServerTransport();
await server.connect(transport);
