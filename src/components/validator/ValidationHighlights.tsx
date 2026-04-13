'use client';

/**
 * ValidationHighlights
 *
 * Replicates the "All-customers scan" summary table from the manual-validation
 * skill (Step 2 / SKILL.md). For every opportunity with PENDING_VALIDATION
 * suggestions, shows:
 *
 *   Opportunity Type | PENDING | ℹ
 *
 * Clicking ℹ fetches and displays the PENDING suggestions inline with
 * type-specific columns, clickable URLs, multi-select, and validate support.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  Flex,
  Heading,
  Text,
  TableView,
  TableHeader,
  TableBody,
  Column,
  Row,
  Cell,
  Well,
  ActionButton,
  DialogTrigger,
  Dialog,
  Content,
  ButtonGroup,
  Button,
  Divider,
  useDialogContainer,
  ProgressCircle,
  Badge,
  Picker,
  Item,
  TooltipTrigger,
  Tooltip,
  type Selection,
} from '@adobe/react-spectrum';
import Info from '@spectrum-icons/workflow/Info';
import CheckmarkCircle from '@spectrum-icons/workflow/CheckmarkCircle';
import CloseCircle from '@spectrum-icons/workflow/CloseCircle';
import AlertCircle from '@spectrum-icons/workflow/AlertCircle';
import { getTrimmedPageUrlFromData } from '@validator-shared/suggestion/pageUrl';
import type { Opportunity } from './OpportunityList';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  opportunityId?: string;
  siteId?: string;
  status: string;
  type?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ValidationResultItem {
  suggestionId: string;
  validation_status: string;
  explanation?: string;
  fixValidated?: boolean;
  fixExplanation?: string;
}

// ─── Classification (mirrors opportunity-types.md) ────────────────────────────

const SCRIPTED_TYPES = new Set([
  'a11y-color-contrast', 'broken-backlinks', 'broken-internal-links', 'canonical',
  'cwv', 'form-accessibility', 'headings', 'high-organic-low-ctr', 'hreflang',
  'meta-tags', 'product-metatags', 'a11y-assistive', 'security-vulnerabilities',
  'structured-data', 'ad-intent-mismatch', 'no-cta-above-the-fold',
]);

const PR_CANDIDATE_TYPES = new Set([
  'alt-text', 'high-page-views', 'paid-traffic', 'readability',
  'security-permissions', 'security-permissions-redundant',
]);

const SKIP_TYPES = new Set([
  'summarization', 'prerender', 'FAQ', 'llm-blocked', 'generic-opportunity',
]);

type OppClass = 'scripted' | 'pr-candidate' | 'skip' | 'unknown';

function classifyType(type: string): OppClass {
  if (SCRIPTED_TYPES.has(type)) return 'scripted';
  if (PR_CANDIDATE_TYPES.has(type)) return 'pr-candidate';
  if (SKIP_TYPES.has(type)) return 'skip';
  return 'unknown';
}

const CLASS_META: Record<OppClass, { label: string; variant: 'positive' | 'yellow' | 'neutral' | 'negative' }> = {
  scripted:       { label: '✅ Script ready',  variant: 'positive' },
  'pr-candidate': { label: '⚠️ PR candidate',  variant: 'yellow'   },
  skip:           { label: '🚫 Skip',           variant: 'neutral'  },
  unknown:        { label: '🔴 Unknown',         variant: 'negative' },
};

const UPDATE_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'PENDING_VALIDATION', label: 'PENDING_VALIDATION' },
  { value: 'NEW',                label: 'NEW' },
  { value: 'APPROVED',           label: 'APPROVED' },
  { value: 'SKIPPED',            label: 'SKIPPED' },
  { value: 'FIXED',              label: 'FIXED' },
  { value: 'IN_PROGRESS',        label: 'IN_PROGRESS' },
  { value: 'OUTDATED',           label: 'OUTDATED' },
  { value: 'REJECTED',           label: 'REJECTED' },
  { value: 'ERROR',              label: 'ERROR' },
];

// ─── Suggestion data helpers ──────────────────────────────────────────────────

function getAiSuggestion(suggestion: Suggestion): string[] {
  const d = (suggestion.data ?? {}) as Record<string, unknown>;
  const list = d.urlsSuggested ?? d.urls_suggested;
  if (Array.isArray(list)) {
    const lines = list.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
    if (lines.length > 0) return lines;
  }
  const single = d.urlSuggested ?? d.url_suggested;
  if (typeof single === 'string' && single.trim()) return [single.trim()];
  const text = d.aiSuggestion ?? d.ai_suggestion;
  if (typeof text === 'string' && text.trim()) return [text.trim()];
  return [];
}

function getAiRationale(suggestion: Suggestion): string | null {
  const d = (suggestion.data ?? {}) as Record<string, unknown>;
  const r = d.aiRationale ?? d.ai_rationale;
  return typeof r === 'string' && r.trim() ? r.trim() : null;
}

// ─── Per-suggestion info dialog ───────────────────────────────────────────────

const LABEL_STYLE: React.CSSProperties = {
  margin: '0 0 4px',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'var(--spectrum-global-color-gray-600)',
  letterSpacing: '0.04em',
};

/** One axe-core issue row inside the dialog, with expand/collapse for raw HTML. */
function IssueSection({
  issue,
  index,
}: {
  issue: Record<string, unknown>;
  index: number;
}) {
  const [htmlOpen, setHtmlOpen] = useState(false);

  const failureSummary = typeof issue.failureSummary === 'string' ? issue.failureSummary : null;
  const wcagLevel      = typeof issue.wcagLevel === 'string' ? issue.wcagLevel : null;
  const wcagRule       = typeof issue.wcagRule  === 'string' ? issue.wcagRule  : null;
  const htmlWithIssues = Array.isArray(issue.htmlWithIssues)
    ? (issue.htmlWithIssues as Array<Record<string, unknown>>)
    : [];

  return (
    <div style={{ borderLeft: '3px solid var(--spectrum-alias-border-color-mid)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700 }}>Issue {index + 1}</span>
        {(wcagLevel || wcagRule) && (
          <span style={{ fontSize: 11, background: 'var(--spectrum-global-color-gray-200)', borderRadius: 4, padding: '1px 6px' }}>
            {[wcagLevel, wcagRule].filter(Boolean).join(' ')}
          </span>
        )}
      </div>

      {failureSummary && (
        <p style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{failureSummary}</p>
      )}

      {htmlWithIssues.map((item, i) => {
        const selector = typeof item.target_selector === 'string' ? item.target_selector : null;
        const html     = typeof item.html === 'string' ? item.html : null;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {selector && (
              <div>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--spectrum-global-color-gray-600)' }}>Selector</span>
                <code style={{ display: 'block', fontSize: 11, wordBreak: 'break-all', marginTop: 2 }}>{selector}</code>
              </div>
            )}
            {html && (
              <div>
                <button
                  onClick={() => setHtmlOpen((v) => !v)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 11, color: 'var(--spectrum-global-color-blue-600)', textDecoration: 'underline',
                  }}
                >
                  {htmlOpen ? '▲ Hide HTML' : '▼ Show HTML'}
                </button>
                {htmlOpen && (
                  <pre style={{
                    margin: '4px 0 0',
                    fontSize: 11,
                    background: 'var(--spectrum-global-color-gray-100)',
                    borderRadius: 4,
                    padding: '8px',
                    maxHeight: 200,
                    overflowY: 'auto',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {html}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SuggestionInfoDialog({ suggestion }: { suggestion: Suggestion }) {
  const dialog = useDialogContainer();
  const suggestionLines = getAiSuggestion(suggestion);
  const rationale = getAiRationale(suggestion);
  const d = (suggestion.data ?? {}) as Record<string, unknown>;
  const tags = d.tags;
  const tagList = Array.isArray(tags) ? (tags as string[]) : undefined;

  // Nested issues array (e.g. a11y-color-contrast from axe-core)
  const issues = Array.isArray(d.issues)
    ? (d.issues as Array<Record<string, unknown>>)
    : null;

  return (
    <>
      <Heading>Suggestion details</Heading>
      <Divider size="S" />
      <Content>
        <div style={{ overflowY: 'auto', wordBreak: 'break-word', padding: '4px 0', maxHeight: '65vh' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div>
              <p style={LABEL_STYLE}>ID</p>
              <code style={{ fontSize: 12 }}>{suggestion.id}</code>
            </div>

            {/* ── Issues array (a11y-color-contrast / axe-core types) ── */}
            {issues && issues.length > 0 && (
              <div>
                <p style={LABEL_STYLE}>Issues ({issues.length})</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {issues.map((issue, i) => (
                    <IssueSection key={i} issue={issue} index={i} />
                  ))}
                </div>
              </div>
            )}

            {/* ── AI suggestion (all other types) ── */}
            {(!issues || issues.length === 0) && (
              <>
                <div>
                  <p style={LABEL_STYLE}>AI suggestion</p>
                  {suggestionLines.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {suggestionLines.map((line, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{line}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ margin: 0, color: 'var(--spectrum-global-color-gray-600)' }}>—</p>
                  )}
                </div>
                <div>
                  <p style={LABEL_STYLE}>Rationale</p>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13 }}>{rationale ?? '—'}</p>
                </div>
              </>
            )}

            {tagList && tagList.length > 0 && (
              <div>
                <p style={LABEL_STYLE}>Tags</p>
                <p style={{ margin: 0, fontSize: 13 }}>{tagList.join(', ')}</p>
              </div>
            )}
          </div>
        </div>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={() => dialog.dismiss()}>Close</Button>
      </ButtonGroup>
    </>
  );
}

// ─── Type-specific column definitions ────────────────────────────────────────

interface TypeColDef {
  uid: string;
  name: string;
  width?: number;
  mono?: boolean;
  extract: (s: Suggestion) => string | string[];
}

const dat = (s: Suggestion): Record<string, unknown> => (s.data as Record<string, unknown>) ?? {};
const str = (v: unknown): string => { if (v == null) return '—'; const t = String(v).trim(); return t || '—'; };
const pick = (s: Suggestion, ...keys: string[]): string => {
  const d = dat(s);
  for (const k of keys) { const v = d[k]; if (v != null && String(v).trim()) return String(v).trim(); }
  return '—';
};

const PAGE_URL  = (uid = 'pageUrl'): TypeColDef => ({ uid, name: 'Page URL',  mono: true, extract: (s) => str(dat(s).pageUrl ?? dat(s).url ?? dat(s).canonicalUrl) });
const AI_SUGG   = (name = 'Proposed'): TypeColDef => ({ uid: 'aiSugg', name, extract: (s) => { const lines = getAiSuggestion(s); return lines.length ? lines : '—'; } });
const RATIONALE = (): TypeColDef => ({ uid: 'rationale', name: 'AI Rationale', extract: (s) => pick(s, 'aiRationale', 'ai_rationale') });

const TYPE_COLS: Record<string, TypeColDef[]> = {
  'meta-tags': [
    { uid: 'pageUrl', name: 'Page URL', mono: true, extract: (s) => str(dat(s).pageUrl ?? dat(s).url ?? dat(s).page ?? dat(s).canonicalUrl) },
    { uid: 'checkType',  name: 'Check Type',    width: 220, extract: (s) => pick(s, 'issue', 'issueType', 'checkType', 'type') },
    { uid: 'tagContent', name: 'Current Value',             extract: (s) => pick(s, 'tagContent', 'tag_content', 'currentValue') },
    AI_SUGG('Proposed Value'),
  ],
  'product-metatags': [
    { uid: 'pageUrl', name: 'Page URL', mono: true, extract: (s) => str(dat(s).pageUrl ?? dat(s).url ?? dat(s).page ?? dat(s).canonicalUrl) },
    { uid: 'checkType',  name: 'Check Type',    width: 220, extract: (s) => pick(s, 'issue', 'issueType', 'checkType', 'type') },
    { uid: 'tagContent', name: 'Current Value',             extract: (s) => pick(s, 'tagContent', 'tag_content', 'currentValue') },
    AI_SUGG('Proposed Value'),
  ],
  'broken-backlinks': [
    { uid: 'url_from', name: 'Referring Domain', mono: true, extract: (s) => pick(s, 'url_from', 'urlFrom', 'referringDomain', 'sourceDomain') },
    { uid: 'priority', name: 'Priority',  width: 100,        extract: (s) => pick(s, 'priority', 'trafficPriority', 'traffic_priority') },
    { uid: 'traffic',  name: 'Traffic',   width: 100,        extract: (s) => pick(s, 'traffic_domain', 'traffic', 'trafficDomain') },
    { uid: 'url_to',   name: 'URL To',    mono: true,        extract: (s) => pick(s, 'url_to', 'urlTo', 'brokenUrl', 'targetUrl', 'href') },
    AI_SUGG('Proposed URLs'),
    RATIONALE(),
  ],
  'broken-internal-links': [
    { uid: 'url_from', name: 'URL From', mono: true, extract: (s) => pick(s, 'urlFrom', 'url_from', 'sourceUrl', 'pageUrl') },
    { uid: 'url_to',   name: 'URL To',   mono: true, extract: (s) => pick(s, 'urlTo', 'url_to', 'brokenUrl', 'targetUrl', 'href') },
    AI_SUGG('Proposed URL'),
  ],
  'canonical': [
    PAGE_URL(),
    { uid: 'current', name: 'Current Canonical', mono: true, extract: (s) => pick(s, 'canonicalUrl', 'canonical', 'currentCanonical') },
    AI_SUGG('Proposed Canonical'),
  ],
  'headings': [
    PAGE_URL(),
    { uid: 'checkType', name: 'Issue',   width: 180, extract: (s) => pick(s, 'checkType', 'issueType', 'type') },
    { uid: 'current',   name: 'Current',             extract: (s) => pick(s, 'tagContent', 'currentHeading', 'headingText', 'currentValue') },
    AI_SUGG('Proposed'),
  ],
  'hreflang': [
    PAGE_URL(),
    { uid: 'checkType', name: 'Issue Type', width: 200, extract: (s) => pick(s, 'checkType', 'issueType', 'type') },
    { uid: 'current',   name: 'Current URL', mono: true, extract: (s) => pick(s, 'url', 'hreflangUrl', 'pageUrl') },
    AI_SUGG('Proposed URLs'),
  ],
  'cwv': [
    PAGE_URL(),
    { uid: 'lcp',  name: 'LCP',  width: 90, extract: (s) => pick(s, 'lcp',  'LCP')  },
    { uid: 'inp',  name: 'INP',  width: 90, extract: (s) => pick(s, 'inp',  'INP')  },
    { uid: 'cls',  name: 'CLS',  width: 90, extract: (s) => pick(s, 'cls',  'CLS')  },
    { uid: 'ttfb', name: 'TTFB', width: 90, extract: (s) => pick(s, 'ttfb', 'TTFB') },
  ],
  'form-accessibility': [
    PAGE_URL(),
    { uid: 'checkType', name: 'Issue Type', width: 240, extract: (s) => pick(s, 'checkType', 'issueType', 'type', 'errorType') },
    { uid: 'element',   name: 'Element',               extract: (s) => pick(s, 'element', 'elementText', 'formElement', 'label') },
    AI_SUGG('Suggested Fix'),
  ],
  'a11y-assistive': [
    PAGE_URL(),
    { uid: 'checkType', name: 'Issue Type', width: 240, extract: (s) => pick(s, 'checkType', 'issueType', 'type', 'errorType') },
    { uid: 'element',   name: 'Element',               extract: (s) => pick(s, 'element', 'elementText', 'selector') },
    AI_SUGG('Suggested Fix'),
  ],
  'a11y-color-contrast': [
    // data.url is the page URL
    { uid: 'pageUrl', name: 'Page URL', mono: true, extract: (s) => str(dat(s).url ?? dat(s).pageUrl) },
    // data.issues[].htmlWithIssues[].target_selector — collect all selectors across issues
    {
      uid: 'selectors',
      name: 'Selectors',
      extract: (s) => {
        const issues = dat(s).issues as Array<{ htmlWithIssues?: Array<{ target_selector?: string }> }> | undefined ?? [];
        const selectors = issues.flatMap((i) =>
          (i.htmlWithIssues ?? []).map((h) => h.target_selector ?? '').filter(Boolean)
        );
        return selectors.length > 0 ? selectors : '—';
      },
    },
    // data.issues[].failureSummary — human-readable description of the violation
    {
      uid: 'failureSummary',
      name: 'Failure Summary',
      extract: (s) => {
        const issues = dat(s).issues as Array<{ failureSummary?: string }> | undefined ?? [];
        const summaries = issues.map((i) => i.failureSummary ?? '').filter(Boolean);
        return summaries.length > 0 ? summaries : '—';
      },
    },
    // data.issues[].wcagLevel + wcagRule — e.g. "AA 1.4.3"
    {
      uid: 'wcag',
      name: 'WCAG',
      width: 100,
      extract: (s) => {
        const issues = dat(s).issues as Array<{ wcagLevel?: string; wcagRule?: string }> | undefined ?? [];
        const first = issues[0];
        if (!first) return '—';
        const parts = [first.wcagLevel, first.wcagRule].filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : '—';
      },
    },
  ],
  'security-vulnerabilities': [
    { uid: 'library', name: 'Library',             extract: (s) => pick(s, 'library', 'package', 'name', 'artifactId') },
    { uid: 'version', name: 'Version', width: 120, extract: (s) => pick(s, 'version', 'currentVersion') },
    { uid: 'cves',    name: 'CVEs',                extract: (s) => { const v = dat(s).cves; return Array.isArray(v) ? (v as string[]).join(', ') : pick(s, 'cves', 'vulnerabilities', 'cve'); } },
    RATIONALE(),
  ],
  'high-organic-low-ctr': [
    PAGE_URL(),
    { uid: 'current', name: 'Current', extract: (s) => pick(s, 'tagContent', 'currentTitle', 'currentDescription', 'currentValue') },
    AI_SUGG('Proposed'),
    RATIONALE(),
  ],
  'structured-data': [
    PAGE_URL(),
    { uid: 'schemaType', name: 'Schema Type', width: 180, extract: (s) => pick(s, 'schemaType', 'schema_type', 'type', 'checkType') },
    { uid: 'issue',      name: 'Issue',                   extract: (s) => pick(s, 'issue', 'issueDescription', 'missingProperty', 'checkType') },
    AI_SUGG('Proposed'),
  ],
  'ad-intent-mismatch': [
    { uid: 'keyword', name: 'Keyword',                    extract: (s) => pick(s, 'keyword', 'searchKeyword', 'query') },
    PAGE_URL(),
    { uid: 'traffic', name: 'Monthly Traffic', width: 130, extract: (s) => pick(s, 'monthlyVisits', 'monthly_visits', 'traffic', 'estimatedTraffic') },
    { uid: 'cpc',     name: 'CPC',             width: 90,  extract: (s) => pick(s, 'cpc', 'costPerClick', 'cost_per_click') },
    RATIONALE(),
  ],
  'no-cta-above-the-fold': [
    PAGE_URL(),
    { uid: 'ctaText', name: 'Proposed CTA Text',          extract: (s) => { const c = dat(s).ctaLinkSuggestion as Record<string,unknown> | undefined; return str(c?.cta_text ?? dat(s).ctaText); } },
    { uid: 'ctaUrl',  name: 'Target URL',     mono: true, extract: (s) => { const c = dat(s).ctaLinkSuggestion as Record<string,unknown> | undefined; return str(c?.target_url ?? dat(s).ctaUrl ?? dat(s).targetUrl); } },
    RATIONALE(),
  ],
  'alt-text': [
    PAGE_URL(),
    { uid: 'element', name: 'Image',       mono: true, extract: (s) => pick(s, 'imageUrl', 'image_url', 'src', 'element') },
    { uid: 'current', name: 'Current Alt',             extract: (s) => pick(s, 'currentAlt', 'current_alt', 'altText', 'alt') },
    AI_SUGG('Proposed Alt'),
  ],
  'readability': [
    PAGE_URL(),
    { uid: 'score',  name: 'Score',  width: 100, extract: (s) => pick(s, 'readabilityScore', 'score', 'fleschScore') },
    { uid: 'issues', name: 'Issues',             extract: (s) => pick(s, 'issues', 'checkType', 'type') },
    AI_SUGG('Suggested Improvement'),
  ],
};

const DEFAULT_COLS: TypeColDef[] = [
  PAGE_URL(),
  { uid: 'checkType', name: 'Type', width: 180, extract: (s) => pick(s, 'checkType', 'type') || str(s.type) },
  AI_SUGG('Suggested Fix'),
  RATIONALE(),
];

const STATUS_COL: TypeColDef = { uid: 'status',  name: 'Status',     width: 182, mono: true, extract: (s) => s.status };
const RESULT_COL: TypeColDef = { uid: '_result', name: 'Validation',  width: 130, extract: () => '' };
const INFO_COL:   TypeColDef = { uid: '_info',   name: '',            width:  50, extract: () => '' };

function getColumnsForType(oppType: string): TypeColDef[] {
  return [...(TYPE_COLS[oppType] ?? DEFAULT_COLS), STATUS_COL, RESULT_COL, INFO_COL];
}

// ─── Validation result cell ───────────────────────────────────────────────────

const RESULT_LABEL: Record<string, string> = {
  real_issue:          'Real issue',
  false_positive:      'Not valid',
  could_not_validate:  'Inconclusive',
  gate_passed:         'Gate passed',
  invalid_data:        'Invalid data',
  error:               'Error',
};

function ValidationResultCell({
  result,
  isValidating,
}: {
  result: ValidationResultItem | undefined;
  isValidating: boolean;
}) {
  if (isValidating) return <ProgressCircle size="S" isIndeterminate aria-label="Validating" />;
  if (!result) return <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-500)', fontSize: 'var(--spectrum-global-dimension-font-size-75)' }}>—</Text>;

  const label = RESULT_LABEL[result.validation_status] ?? result.validation_status;
  const isPass = result.validation_status === 'real_issue' || result.validation_status === 'gate_passed';
  const isFail = result.validation_status === 'false_positive' || result.validation_status === 'invalid_data' || result.validation_status === 'error';
  const color  = isPass
    ? 'var(--spectrum-semantic-positive-color-default)'
    : isFail
      ? 'var(--spectrum-semantic-negative-color-default)'
      : 'var(--spectrum-global-color-gray-600)';

  const icon = isPass
    ? <CheckmarkCircle size="S" aria-hidden />
    : isFail
      ? <CloseCircle size="S" aria-hidden />
      : <AlertCircle size="S" aria-hidden />;

  const explanation = result.explanation?.trim();
  const fixExplanation = result.fixExplanation?.trim();
  const hasTooltip = !!(explanation || fixExplanation);

  // Build structured lines: split explanation on |, append fixExplanation
  const tooltipLines: Array<{ text: string; pass: boolean | null }> = [];
  if (explanation) {
    for (const part of explanation.split('|')) {
      const t = part.trim();
      if (!t) continue;
      const pass = t.startsWith('✓') ? true : t.startsWith('✗') ? false : null;
      tooltipLines.push({ text: pass !== null ? t.slice(1).trim() : t, pass });
    }
  }
  if (fixExplanation) {
    const pass = fixExplanation.startsWith('✓') ? true : fixExplanation.startsWith('✗') ? false : null;
    tooltipLines.push({ text: pass !== null ? fixExplanation.slice(1).trim() : fixExplanation, pass });
  }

  const tooltipContent = tooltipLines.length > 0 ? (
    <div style={{ padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tooltipLines.map((line, i) => {
        const symbolColor = line.pass === true
          ? '#1a7f46'   // dark green — readable on light tooltip bg
          : line.pass === false
            ? '#c83b35'  // dark red — readable on light tooltip bg
            : 'inherit';
        return (
          <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            {line.pass !== null && (
              <span style={{ color: symbolColor, flexShrink: 0, fontWeight: 900, lineHeight: '1.2', fontSize: 17 }}>
                {line.pass ? '✓' : '✗'}
              </span>
            )}
            <span style={{ lineHeight: '1.4' }}>{line.text}</span>
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <Flex alignItems="center" gap="size-75">
      {hasTooltip ? (
        <TooltipTrigger delay={200}>
          <ActionButton
            isQuiet
            aria-label={`${label}${explanation ? `: ${explanation}` : ''}`}
            UNSAFE_style={{ color, minWidth: 0, width: 20, height: 20, padding: 0 }}
          >
            {icon}
          </ActionButton>
          <Tooltip maxWidth={480}>{tooltipContent ?? explanation}</Tooltip>
        </TooltipTrigger>
      ) : (
        <span style={{ color }}>{icon}</span>
      )}
      <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)' }}>{label}</Text>
    </Flex>
  );
}

// ─── Expanded suggestion table ────────────────────────────────────────────────

const isUrl = (v: string) => /^https?:\/\//i.test(v);

function CellValue({ lines, mono }: { lines: string[]; mono?: boolean }) {
  if (lines.length === 0 || (lines.length === 1 && lines[0] === '—')) {
    return <Text UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)', color: 'var(--spectrum-global-color-gray-500)' }}>—</Text>;
  }
  return (
    <Flex direction="column" gap="size-50">
      {lines.map((line, i) =>
        isUrl(line) ? (
          <a
            key={i}
            href={line}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 'var(--spectrum-global-dimension-font-size-75)',
              fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
              wordBreak: 'break-all',
              color: 'var(--spectrum-global-color-blue-600)',
              textDecoration: 'none',
            }}
          >
            {line}
          </a>
        ) : (
          <Text
            key={i}
            UNSAFE_style={{
              fontSize: 'var(--spectrum-global-dimension-font-size-75)',
              wordBreak: 'break-all',
              ...(mono ? { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : {}),
            }}
          >
            {line}
          </Text>
        )
      )}
    </Flex>
  );
}

interface ExpandedSuggestionsProps {
  opp: Opportunity;
  suggestions: Suggestion[];
  loading: boolean;
  error: string | null;
  onValidate: (ids: string[]) => void;
  validating: boolean;
  validationResults: Record<string, ValidationResultItem>;
  validatingSuggIds: Set<string>;
  onUpdateStatus: (ids: string[], status: string) => Promise<void>;
  updatingStatus: boolean;
}

function ExpandedSuggestions({
  opp,
  suggestions,
  loading,
  error,
  onValidate,
  validating,
  validationResults,
  validatingSuggIds,
  onUpdateStatus,
  updatingStatus,
}: ExpandedSuggestionsProps) {
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [updateStatusValue, setUpdateStatusValue] = useState('PENDING_VALIDATION');

  const cls = classifyType(opp.type);
  const meta = CLASS_META[cls];
  const columns = getColumnsForType(opp.type);

  const selectedIds = useMemo(() => {
    if (selectedKeys === 'all') return suggestions.map((s) => s.id);
    if (selectedKeys instanceof Set) return [...selectedKeys].map(String);
    return [];
  }, [selectedKeys, suggestions]);

  const allSelected = suggestions.length > 0 && selectedIds.length === suggestions.length;
  const someSelected = selectedIds.length > 0;

  // Embed validation state into each item so React Spectrum's collection
  // detects the change and re-renders cells (items must change by reference).
  const displayItems = useMemo(
    () =>
      suggestions.map((s) => ({
        ...s,
        _validationResult: validationResults[s.id] as ValidationResultItem | undefined,
        _isValidating: validatingSuggIds.has(s.id),
      })),
    [suggestions, validationResults, validatingSuggIds]
  );

  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(suggestions.map((s) => s.id)));
    }
  }, [allSelected, suggestions]);

  return (
    <Flex direction="column" gap="size-150" UNSAFE_style={{ padding: 'var(--spectrum-global-dimension-size-200)' }}>
      {/* Header row */}
      <Flex direction="row" alignItems="center" justifyContent="space-between" gap="size-150" wrap>
        <Flex direction="row" alignItems="center" gap="size-150">
          <Text UNSAFE_style={{ fontWeight: 600, fontSize: 'var(--spectrum-global-dimension-font-size-200)' }}>
            {opp.type}
          </Text>
          <Badge variant={meta.variant} UNSAFE_style={{ fontSize: 'var(--spectrum-global-dimension-font-size-75)' }}>
            {meta.label}
          </Badge>
        </Flex>

        {!loading && !error && suggestions.length > 0 && (
          <Flex direction="row" alignItems="center" gap="size-150" wrap>
            <Button variant="secondary" onPress={handleToggleAll} isDisabled={validating || updatingStatus}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </Button>
            <Button
              variant="accent"
              onPress={() => onValidate(selectedIds)}
              isDisabled={!someSelected || validating || updatingStatus}
            >
              {validating ? 'Validating…' : `Validate${someSelected ? ` (${selectedIds.length})` : ''}`}
            </Button>
            <Flex direction="row" alignItems="center" gap="size-100">
              <Picker
                label="Update to"
                labelPosition="side"
                selectedKey={updateStatusValue}
                onSelectionChange={(k) => setUpdateStatusValue(String(k))}
                isDisabled={updatingStatus || !someSelected}
                width="size-3600"
              >
                {UPDATE_STATUS_OPTIONS.map((opt) => (
                  <Item key={opt.value}>{opt.label}</Item>
                ))}
              </Picker>
              <Button
                variant="secondary"
                onPress={() => onUpdateStatus(selectedIds, updateStatusValue)}
                isDisabled={updatingStatus || !someSelected}
              >
                {updatingStatus ? 'Updating…' : 'Update'}
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>

      {loading && (
        <Flex alignItems="center" gap="size-100">
          <ProgressCircle size="S" isIndeterminate aria-label="Loading suggestions" />
          <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>Loading suggestions…</Text>
        </Flex>
      )}

      {error && (
        <Text UNSAFE_style={{ color: 'var(--spectrum-semantic-negative-color-default)' }}>{error}</Text>
      )}

      {!loading && !error && suggestions.length === 0 && (
        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>No PENDING_VALIDATION suggestions found.</Text>
      )}

      {!loading && !error && suggestions.length > 0 && (
        <div style={{ overflowX: 'auto', width: '100%' }}>
        <TableView
          aria-label={`Pending suggestions for ${opp.type}`}
          selectionMode="multiple"
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
          width="100%"
          overflowMode="wrap"
          UNSAFE_style={{ minWidth: 1400 }}
        >
          <TableHeader columns={columns}>
            {(col) => <Column key={col.uid} width={col.width}>{col.name}</Column>}
          </TableHeader>
          <TableBody items={displayItems}>
            {(s) => (
              <Row key={s.id}>
                {(columnKey) => {
                  if (columnKey === '_info') {
                    return (
                      <Cell>
                        <DialogTrigger isDismissable>
                          <ActionButton isQuiet aria-label="Suggestion info">
                            <Info />
                          </ActionButton>
                          {() => (
                            <Dialog width="size-8000">
                              <SuggestionInfoDialog suggestion={s} />
                            </Dialog>
                          )}
                        </DialogTrigger>
                      </Cell>
                    );
                  }

                  if (columnKey === '_result') {
                    return (
                      <Cell>
                        <ValidationResultCell
                          result={s._validationResult}
                          isValidating={s._isValidating}
                        />
                      </Cell>
                    );
                  }

                  const colDef = columns.find((c) => c.uid === columnKey);
                  if (!colDef) return <Cell>—</Cell>;

                  const value = colDef.extract(s);
                  const lines = Array.isArray(value) ? value : [value];

                  return (
                    <Cell>
                      <CellValue lines={lines} mono={colDef.mono} />
                    </Cell>
                  );
                }}
              </Row>
            )}
          </TableBody>
        </TableView>
        </div>
      )}
    </Flex>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ValidationHighlightsProps {
  opportunities: Opportunity[];
  onSelect: (opportunity: Opportunity) => void;
  siteId: string;
  accessToken: string;
}

const COLUMNS = [
  { uid: 'type',    name: 'Opportunity Type' },
  { uid: 'pending', name: 'PENDING', width: 120 },
  { uid: 'open',    name: '', width: 56 },
];

const muted = {
  fontSize: 'var(--spectrum-global-dimension-font-size-75)',
  color: 'var(--spectrum-global-color-gray-600)',
} as const;

export function ValidationHighlights({ opportunities, onSelect, siteId, accessToken }: ValidationHighlightsProps) {
  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);
  const [expandedOpp, setExpandedOpp] = useState<Opportunity | null>(null);
  const [expandedSuggestions, setExpandedSuggestions] = useState<Suggestion[]>([]);
  const [expandedLoading, setExpandedLoading] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResultItem>>({});
  const [validatingSuggIds, setValidatingSuggIds] = useState<Set<string>>(new Set());
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const pending = opportunities.filter((o) => o.hasPendingValidation);

  async function handleInfo(opp: Opportunity) {
    if (expandedOppId === opp.id) {
      setExpandedOppId(null);
      setExpandedOpp(null);
      setExpandedSuggestions([]);
      return;
    }
    // Reset validation state when switching opportunity
    setValidating(false);
    setValidationResults({});
    setValidatingSuggIds(new Set());

    setExpandedOppId(opp.id);
    setExpandedOpp(opp);
    setExpandedLoading(true);
    setExpandedError(null);
    setExpandedSuggestions([]);
    try {
      const res = await fetch(
        `/api/spacecat/sites/${siteId}/opportunities/${opp.id}/suggestions`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const pendingSuggestions = (Array.isArray(data) ? data as Suggestion[] : ((data as { data?: Suggestion[] }).data ?? [])).filter(
        (s) => s.status === 'PENDING_VALIDATION'
      );
      setExpandedSuggestions(pendingSuggestions);
    } catch (e) {
      setExpandedError(e instanceof Error ? e.message : 'Failed to load suggestions');
    } finally {
      setExpandedLoading(false);
    }
  }

  const handleValidate = useCallback(async (suggestionIds: string[]) => {
    if (!expandedOpp || validating || suggestionIds.length === 0) return;
    setValidating(true);
    setValidatingSuggIds(new Set(suggestionIds));

    const baseUrl = `/api/validator/sites/${siteId}/opportunities/${expandedOpp.id}/validate`;

    await Promise.allSettled(
      suggestionIds.map(async (id) => {
        const suggPayload = expandedSuggestions.find((s) => s.id === id);
        try {
          const res = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              suggestionIds: [id],
              ...(suggPayload ? { suggestions: [suggPayload], opportunity: expandedOpp } : {}),
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { results?: ValidationResultItem[] };
          const result = data.results?.[0];
          if (result) {
            setValidationResults((prev) => ({ ...prev, [result.suggestionId]: result }));
          }
        } catch {
          setValidationResults((prev) => ({
            ...prev,
            [id]: { suggestionId: id, validation_status: 'error', explanation: 'Validation failed' },
          }));
        } finally {
          setValidatingSuggIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        }
      })
    );

    setValidating(false);
  }, [expandedOpp, expandedSuggestions, siteId, accessToken, validating]);

  const handleUpdateStatus = useCallback(async (suggestionIds: string[], status: string) => {
    if (!expandedOpp || updatingStatus || suggestionIds.length === 0) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(
        `/api/spacecat/sites/${siteId}/opportunities/${expandedOpp.id}/suggestions/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(suggestionIds.map((id) => ({ id, status }))),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
      }
      // Re-fetch and re-filter so moved-out suggestions disappear from the list
      const res2 = await fetch(
        `/api/spacecat/sites/${siteId}/opportunities/${expandedOpp.id}/suggestions`,
        { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (res2.ok) {
        const data = await res2.json();
        const allSuggs: Suggestion[] = Array.isArray(data) ? data : ((data as { data?: Suggestion[] }).data ?? []);
        setExpandedSuggestions(allSuggs.filter((s) => s.status === 'PENDING_VALIDATION'));
      }
    } catch {
      // leave suggestions as-is on error
    } finally {
      setUpdatingStatus(false);
    }
  }, [expandedOpp, siteId, accessToken, updatingStatus]);

  if (pending.length === 0) return null;

  return (
    <Flex direction="column" gap="size-150">
      <Flex direction="row" alignItems="baseline" gap="size-150">
        <Heading level={2} margin={0}>Pending Validations</Heading>
        <Text UNSAFE_style={muted}>
          {pending.length} opportunit{pending.length === 1 ? 'y' : 'ies'} awaiting ESE review
        </Text>
      </Flex>

      <Well UNSAFE_style={{ padding: 0 }}>
        <TableView
          aria-label="Pending validations scan table"
          selectionMode="none"
          width="100%"
          UNSAFE_style={{ minHeight: 0 }}
        >
          <TableHeader columns={COLUMNS}>
            {(col) => <Column key={col.uid} width={col.width}>{col.name}</Column>}
          </TableHeader>
          <TableBody items={pending}>
            {(opp) => {
              const pendingCount = opp.pendingValidationCount ?? (opp.hasPendingValidation ? '1+' : 0);
              const isExpanded = expandedOppId === opp.id;
              return (
                <Row key={opp.id}>
                  {(columnKey) => {
                    if (columnKey === 'type') {
                      return <Cell><Text UNSAFE_style={{ fontWeight: 600 }}>{opp.type || '—'}</Text></Cell>;
                    }
                    if (columnKey === 'pending') {
                      return (
                        <Cell>
                          <Text UNSAFE_style={{ fontWeight: 700, fontSize: 'var(--spectrum-global-dimension-font-size-200)', color: 'var(--spectrum-semantic-negative-color-default)' }}>
                            {pendingCount}
                          </Text>
                        </Cell>
                      );
                    }
                    if (columnKey === 'open') {
                      return (
                        <Cell>
                          <ActionButton
                            isQuiet
                            aria-label={isExpanded ? 'Collapse suggestions' : 'Show suggestions'}
                            aria-pressed={isExpanded}
                            onPress={() => handleInfo(opp)}
                            UNSAFE_style={{ color: isExpanded ? 'var(--spectrum-global-color-blue-600)' : undefined }}
                          >
                            <Info />
                          </ActionButton>
                        </Cell>
                      );
                    }
                    return <Cell>—</Cell>;
                  }}
                </Row>
              );
            }}
          </TableBody>
        </TableView>

        {expandedOpp && (
          <>
            <div style={{ height: 1, background: 'var(--spectrum-alias-border-color-muted)' }} />
            <ExpandedSuggestions
              opp={expandedOpp}
              suggestions={expandedSuggestions}
              loading={expandedLoading}
              error={expandedError}
              onValidate={handleValidate}
              validating={validating}
              validationResults={validationResults}
              validatingSuggIds={validatingSuggIds}
              onUpdateStatus={handleUpdateStatus}
              updatingStatus={updatingStatus}
            />
          </>
        )}
      </Well>
    </Flex>
  );
}
