'use client';

import './SuggestionList.css';
import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { Suggestion as SharedSuggestion, SuggestionStatus } from '@validator-shared/types';
import { getIssueTypeLabel } from '@validator-shared/hreflang/issueType';
import {
  getOpenHrefForUrlFrom,
  getOpenHrefForUrlTo,
  getUrlFromDisplay,
  getUrlToDisplay,
  mergedSuggestionFields,
} from '@validator-shared/suggestion/brokenInternalLinks';
import { getTrimmedPageUrlFromData } from '@validator-shared/suggestion/pageUrl';
import type { Selection } from '@adobe/react-spectrum';
import {
  Flex,
  Heading,
  Text,
  Button,
  TableView,
  TableHeader,
  TableBody,
  Column,
  Row,
  Cell,
  Picker,
  DialogTrigger,
  Dialog,
  Content,
  Divider,
  ButtonGroup,
  useDialogContainer,
  MenuTrigger,
  Menu,
  ActionButton,
  Item,
  ProgressCircle,
  Tooltip,
  TooltipTrigger,
} from '@adobe/react-spectrum';
import CheckmarkCircle from '@spectrum-icons/workflow/CheckmarkCircle';
import CloseCircle from '@spectrum-icons/workflow/CloseCircle';
import AlertCircle from '@spectrum-icons/workflow/AlertCircle';

export interface Suggestion {
  id: string;
  opportunityId: string;
  siteId?: string;
  status: string;
  type?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ValidationResultItem {
  suggestionId: string;
  validation_status: string;
  explanation?: string;
  fixValidated?: boolean;
  fixExplanation?: string;
}

type SortColumn =
  | 'url'
  | 'issue_type'
  | 'url_from'
  | 'url_to'
  | 'status'
  | 'validationIssue'
  | 'validationFix';
type SortDirection = 'asc' | 'desc';

interface OpportunityInfo {
  auditId?: string;
  tags?: string[];
  /** Used to show hreflang-only bulk selection (type/title from SpaceCat). */
  type?: string;
  title?: string;
}

function isHreflangOpportunity(opportunity: OpportunityInfo | null | undefined): boolean {
  if (!opportunity) return false;
  const type = String(opportunity.type ?? '').toLowerCase();
  const title = String(opportunity.title ?? '').toLowerCase();
  return type === 'hreflang' || title.includes('hreflang');
}

interface SuggestionListProps {
  suggestions: Suggestion[];
  loading?: boolean;
  error: string | null;
  onValidate?: (suggestionIds: string[]) => Promise<void>;
  validating?: boolean;
  validationResultBySuggestionId?: Record<string, ValidationResultItem>;
  validatingSuggestionIds?: Set<string>;
  opportunity?: OpportunityInfo | null;
  /** Registry id from `mapOpportunityToTypeId` (e.g. broken-internal-links). Drives table columns. */
  opportunityTypeId?: string;
  onUpdateStatus?: (suggestionIds: string[], status: SuggestionStatus) => Promise<void>;
  updatingStatus?: boolean;
}

const STATUS_OPTIONS: { value: 'all' | SuggestionStatus; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'PENDING_VALIDATION', label: 'PENDING_VALIDATION' },
  { value: 'NEW', label: 'NEW' },
  { value: 'APPROVED', label: 'APPROVED' },
  { value: 'REJECTED', label: 'REJECTED' },
  { value: 'SKIPPED', label: 'SKIPPED' },
  { value: 'FIXED', label: 'FIXED' },
  { value: 'IN_PROGRESS', label: 'IN_PROGRESS' },
  { value: 'OUTDATED', label: 'OUTDATED' },
  { value: 'ERROR', label: 'ERROR' },
];

const UPDATE_STATUS_OPTIONS: { value: SuggestionStatus; label: string }[] = STATUS_OPTIONS.filter(
  (opt): opt is { value: SuggestionStatus; label: string } => opt.value !== 'all'
);

function suggestionSummary(s: Suggestion): string {
  const d = s.data;
  if (!d || typeof d !== 'object') return s.id;
  const url = getTrimmedPageUrlFromData(d);
  if (url) return url;
  const type = (d.checkType ?? d.type) as string | undefined;
  if (type) return type;
  return s.id;
}

function labelForValidationStatus(status: string): string {
  const labels: Record<string, string> = {
    real_issue: 'Real issue',
    false_positive: 'Not valid',
    could_not_validate: 'Could not validate',
    gate_passed: 'Gate passed',
    invalid_data: 'Invalid data',
    error: 'Error',
  };
  return labels[status] ?? status;
}

const FIX_VALIDATION_NOT_RUN_MESSAGE =
  'The suggested fix was not checked. The LLM may not be configured or the request may have failed.';

/**
 * Pass = verification confirms the reported issue exists (real_issue) or gate-only success (gate_passed).
 * Fail = verification could not run (bad data or error). Neutral = inconclusive.
 * not_valid_issue = suggestion is not valid (red CloseCircle, same as fail).
 * Note: real_issue uses a green check — the check succeeded in confirming the issue, not "site passed".
 */
type IssueVerificationOutcome = 'pass' | 'fail' | 'neutral' | 'not_valid_issue';

function issueVerificationPresentation(status: string): {
  title: string;
  outcome: IssueVerificationOutcome;
} {
  switch (status) {
    case 'false_positive':
      return {
        outcome: 'not_valid_issue',
        title: 'Reported issue not found',
      };
    case 'real_issue':
      return {
        outcome: 'pass',
        title: 'Reported issue confirmed on the page',
      };
    case 'could_not_validate':
      return {
        outcome: 'neutral',
        title: 'Could not verify the issue automatically',
      };
    case 'gate_passed':
      return {
        outcome: 'pass',
        title: 'Initial checks passed',
      };
    case 'invalid_data':
      return {
        outcome: 'fail',
        title: 'Suggestion data is invalid or incomplete',
      };
    case 'error':
      return {
        outcome: 'fail',
        title: 'Validation failed to run',
      };
    default:
      return {
        outcome: 'neutral',
        title: labelForValidationStatus(status),
      };
  }
}

const outcomeIconClass = (outcome: IssueVerificationOutcome, compact?: boolean) =>
  [
    'validation-details-outcome-icon',
    outcome === 'pass'
      ? 'validation-details-outcome-icon--pass'
      : outcome === 'fail' || outcome === 'not_valid_issue'
        ? 'validation-details-outcome-icon--fail'
        : 'validation-details-outcome-icon--neutral',
    compact ? 'validation-outcome-icon--table' : '',
  ]
    .filter(Boolean)
    .join(' ');

/** Green / red / gray circle icons — modal (default) and table (compact + smaller size).
 *  not_valid_issue uses red CloseCircle (same icon and styling as fail). */
function ValidationOutcomeIcon({
  outcome,
  size = 'M',
  compact = false,
}: {
  outcome: IssueVerificationOutcome;
  size?: 'S' | 'M' | 'L';
  compact?: boolean;
}) {
  const iconSize = size;
  if (outcome === 'pass') {
    return (
      <span className={outcomeIconClass(outcome, compact)} aria-hidden>
        <CheckmarkCircle size={iconSize} />
      </span>
    );
  }
  if (outcome === 'fail' || outcome === 'not_valid_issue') {
    return (
      <span className={outcomeIconClass(outcome, compact)} aria-hidden>
        <CloseCircle size={iconSize} />
      </span>
    );
  }
  return (
    <span className={outcomeIconClass(outcome, compact)} aria-hidden>
      <AlertCircle size={iconSize} />
    </span>
  );
}

function issueVerificationStatusWord(
  outcome: IssueVerificationOutcome,
  validationStatus?: string
): string {
  if (outcome === 'not_valid_issue' || validationStatus === 'false_positive') {
    return 'Not valid';
  }
  if (outcome === 'pass') return 'Valid';
  if (outcome === 'fail') return 'Invalid';
  return 'Inconclusive';
}

/** For sorting table rows by issue vs fix outcome (lower = pass, higher = fail / no data). */
function validationOutcomeSortKey(
  result: ValidationResultItem | undefined,
  mode: 'issue' | 'fix'
): number {
  if (!result) return 99;
  const o =
    mode === 'issue'
      ? issueVerificationPresentation(result.validation_status).outcome
      : suggestedFixPresentation(result.validation_status, result.fixValidated).outcome;
  if (o === 'pass') return 0;
  if (o === 'neutral') return 1;
  return 2;
}

/**
 * Inner content only — parent must wrap in <Cell>. TableView rows require <Cell> as the direct
 * return from the column renderer; a wrapper component that returns <Cell> breaks getCollectionNode.
 */
function ValidationIconCellInner({
  suggestion,
  result,
  mode,
  isValidating,
}: {
  suggestion: Suggestion;
  result: ValidationResultItem | undefined;
  mode: 'issue' | 'fix';
  isValidating: boolean;
}) {
  if (isValidating) {
    return <ProgressCircle size="S" isIndeterminate aria-label="Validating" />;
  }
  if (!result) {
    return <>—</>;
  }
  const { outcome } =
    mode === 'issue'
      ? issueVerificationPresentation(result.validation_status)
      : suggestedFixPresentation(result.validation_status, result.fixValidated);
  const word =
    mode === 'issue'
      ? issueVerificationStatusWord(outcome, result.validation_status)
      : issueVerificationStatusWord(outcome);
  const label =
    mode === 'issue'
      ? `Issue verification: ${word}. Open details.`
      : `Suggested fix: ${word}. Open details.`;
  return (
    <DialogTrigger type="modal" isDismissable>
      <ActionButton isQuiet aria-label={label} UNSAFE_className="validation-outcome-icon-button">
        <ValidationOutcomeIcon outcome={outcome} size="S" compact />
      </ActionButton>
      <Dialog size="L" isDismissable>
        <ValidationDetailsDialogContent suggestion={suggestion} result={result} />
      </Dialog>
    </DialogTrigger>
  );
}

/** Explanation for suggested fix review (AI or N/A by status). */
function suggestedFixReasonText(
  status: string,
  fixValidated: boolean | undefined,
  fixExplanation: string
): string {
  const ex = fixExplanation.trim();
  if (status === 'real_issue') {
    if (fixValidated === true) {
      return ex || 'The AI marked the suggested fix as correct and sufficient.';
    }
    if (fixValidated === false) {
      return ex || 'The AI marked the suggested fix as incorrect or insufficient.';
    }
    return FIX_VALIDATION_NOT_RUN_MESSAGE;
  }
  if (ex) return ex;
  switch (status) {
    case 'false_positive':
      return 'No fix was evaluated because the suggestion was not valid for this page.';
    case 'gate_passed':
      return 'The suggested fix can be evaluated after the AI review step runs on a full validation.';
    case 'could_not_validate':
      return 'The suggested fix was not evaluated because the issue could not be verified.';
    case 'invalid_data':
    case 'error':
      return 'Fix validation was skipped due to invalid suggestion data or a validation error.';
    default:
      return 'No fix assessment is available for this result.';
  }
}

/** Short lead line after Valid / Not valid / Invalid / Inconclusive — detail comes from suggestedFixReasonText. */
function suggestedFixPresentation(
  status: string,
  fixValidated: boolean | undefined
): { title: string; outcome: IssueVerificationOutcome } {
  if (status === 'false_positive') {
    return { outcome: 'not_valid_issue', title: 'No fix to validate' };
  }
  if (status === 'invalid_data' || status === 'error') {
    return { outcome: 'neutral', title: 'Fix not reviewed' };
  }
  if (status === 'gate_passed') {
    return { outcome: 'neutral', title: 'Fix not reviewed' };
  }
  if (status === 'could_not_validate') {
    return { outcome: 'neutral', title: 'Fix not reviewed' };
  }
  if (status === 'real_issue') {
    if (fixValidated === true) {
      return { outcome: 'pass', title: 'Suggested fix passed review' };
    }
    if (fixValidated === false) {
      return { outcome: 'fail', title: 'Suggested fix did not pass review' };
    }
    return { outcome: 'neutral', title: 'Suggested fix not evaluated' };
  }
  return { outcome: 'neutral', title: 'No fix assessment available' };
}

/** Proposed URLs + AI rationale (ESS / SpaceCat: urlsSuggested, urlSuggested, aiRationale). */
function getAiSuggestionAndRationale(suggestion: Suggestion): {
  suggestionLines: string[];
  rationale: string | null;
} {
  const m = mergedSuggestionFields(suggestion as SharedSuggestion);
  const lines: string[] = [];
  const listRaw = m.urlsSuggested ?? m.urls_suggested;
  if (Array.isArray(listRaw)) {
    for (const item of listRaw) {
      if (typeof item === 'string' && item.trim()) lines.push(item.trim());
    }
  }
  const single = m.urlSuggested ?? m.url_suggested;
  if (lines.length === 0 && typeof single === 'string' && single.trim()) {
    lines.push(single.trim());
  }
  const r = m.aiRationale ?? m.ai_rationale;
  const rationale = typeof r === 'string' && r.trim() ? r.trim() : null;
  return { suggestionLines: lines, rationale };
}

function SuggestionIdDialogContent({
  suggestion,
  opportunity,
}: {
  suggestion: Suggestion;
  opportunity?: OpportunityInfo | null;
}) {
  const dialog = useDialogContainer();
  const auditId = opportunity?.auditId ?? (suggestion as { auditId?: string }).auditId ?? (suggestion.data as { auditId?: string } | undefined)?.auditId;
  const tags = opportunity?.tags ?? (suggestion as { tags?: string[] }).tags ?? (suggestion.data as { tags?: string[] } | undefined)?.tags;
  const tagList = Array.isArray(tags) ? tags : undefined;
  const auditIdStr =
    auditId != null && String(auditId).trim() !== '' ? String(auditId).trim() : null;
  const { suggestionLines, rationale } = getAiSuggestionAndRationale(suggestion);

  return (
    <>
      <Heading>Suggestion info</Heading>
      <Divider size="S" />
      <Content>
        <div className="validation-details-modal-scroll suggestion-info-modal-body">
          <section className="suggestion-info-section" aria-label="Suggestion details">
            <div className="suggestion-info-fields">
              <div className="suggestion-info-field">
                <span className="validation-details-field-label">ID</span>
                <p className="suggestion-info-value">
                  <code>{suggestion.id}</code>
                </p>
              </div>
              {auditIdStr != null && (
                <div className="suggestion-info-field">
                  <span className="validation-details-field-label">Audit ID</span>
                  <p className="suggestion-info-value">
                    <code>{auditIdStr}</code>
                  </p>
                </div>
              )}
              <div className="suggestion-info-subsection" aria-label="AI suggestion and rationale">
                <div className="suggestion-info-field">
                  <span className="validation-details-field-label">AI suggestion</span>
                  {suggestionLines.length > 0 ? (
                    <ul className="suggestion-info-ai-list suggestion-info-value">
                      {suggestionLines.map((line, i) => (
                        <li key={`${i}-${line.slice(0, 24)}`}>
                          <code>{line}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="suggestion-info-value">—</p>
                  )}
                </div>
                <div className="suggestion-info-field">
                  <span className="validation-details-field-label">Rationale</span>
                  <p className="suggestion-info-value suggestion-info-rationale">
                    {rationale ?? '—'}
                  </p>
                </div>
              </div>
              {tagList != null && tagList.length > 0 && (
                <div className="suggestion-info-field">
                  <span className="validation-details-field-label">Tags</span>
                  <p className="suggestion-info-tags">{tagList.join(', ')}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={() => dialog.dismiss()}>
          Close
        </Button>
      </ButtonGroup>
    </>
  );
}

function ValidationDetailsDialogContent({
  suggestion,
  result,
}: {
  suggestion: Suggestion;
  result: ValidationResultItem;
}) {
  const dialog = useDialogContainer();
  const explanation = (result.explanation ?? '').trim();
  const fixExplanation = (result.fixExplanation ?? '').trim();
  const issueRow = issueVerificationPresentation(result.validation_status);
  const fixRow = suggestedFixPresentation(result.validation_status, result.fixValidated);
  const fixWord = issueVerificationStatusWord(fixRow.outcome);
  const hasIssueExplanationDetail = explanation.length > 0;
  const fixDetailText = suggestedFixReasonText(
    result.validation_status,
    result.fixValidated,
    fixExplanation
  );
  const hasFixDetail = fixDetailText.trim().length > 0;

  return (
    <>
      <Heading>Validation results</Heading>
      <Divider size="S" />
      <Content>
        <div className="validation-details-modal-scroll">
          <section className="validation-details-section" aria-labelledby="validation-section-issue">
            <p id="validation-section-issue" className="validation-details-section-compact">
              <strong>Issue verification</strong>
              <span className="validation-details-section-inline-hint">
                {' '}
                — Verifies the finding against the page, schema, or AI result.
              </span>
            </p>
            <div
              className="validation-details-verification-row validation-details-verification-row--stacked"
              role="status"
              aria-label={`Issue verification: ${issueVerificationStatusWord(issueRow.outcome, result.validation_status)}. ${issueRow.title}${hasIssueExplanationDetail ? ` ${explanation}` : ''}`}
            >
              <ValidationOutcomeIcon outcome={issueRow.outcome} />
              <div className="validation-details-verification-body">
                <p className="validation-details-verification-summary">
                  <strong
                    className={`validation-details-verification-status validation-details-verification-status--${issueRow.outcome}`}
                  >
                    {issueVerificationStatusWord(issueRow.outcome, result.validation_status)}
                  </strong>
                  <span className="validation-details-verification-lead"> — {issueRow.title}</span>
                </p>
                {hasIssueExplanationDetail && (
                  <p className="validation-details-verification-desc">{explanation}</p>
                )}
              </div>
            </div>
          </section>

          <section className="validation-details-section" aria-labelledby="validation-section-fix">
            <p id="validation-section-fix" className="validation-details-section-compact">
              <strong>Suggested fix</strong>
              <span className="validation-details-section-inline-hint">
                {' '}
                — AI review of whether SpaceCat&apos;s suggested fix fits the issue (runs when the issue is confirmed).
              </span>
            </p>
            <div
              className="validation-details-verification-row validation-details-verification-row--stacked"
              role="status"
              aria-label={`Suggested fix: ${fixWord}. ${fixRow.title}${hasFixDetail ? ` ${fixDetailText}` : ''}`}
            >
              <ValidationOutcomeIcon outcome={fixRow.outcome} />
              <div className="validation-details-verification-body">
                <p className="validation-details-verification-summary">
                  <strong
                    className={`validation-details-verification-status validation-details-verification-status--${fixRow.outcome}`}
                  >
                    {fixWord}
                  </strong>
                  <span className="validation-details-verification-lead"> — {fixRow.title}</span>
                </p>
                {hasFixDetail && (
                  <p className="validation-details-verification-desc">{fixDetailText}</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </Content>
      <ButtonGroup>
        <Button variant="secondary" onPress={() => dialog.dismiss()}>
          Close
        </Button>
      </ButtonGroup>
    </>
  );
}

interface TableRowData {
  id: string;
  suggestion: Suggestion;
  urlLabel: string;
  issueTypeLabel: string;
  /** broken-internal-links columns */
  urlFromLabel: string;
  urlToLabel: string;
  status: string;
  result?: ValidationResultItem;
  isValidating: boolean;
}

/**
 * Icon / action columns: wide enough for header text (e.g. "suggestion" on one line) + controls.
 */
const COLUMN_WIDTH_ICON = 120;
/** Room for long URLs — tuned vs Issue type so URL shows ~5 more chars per line. */
const COLUMN_MIN_WIDTH_URL = 185;
/** Narrower than before to give URL more space; overflow uses ellipsis + tooltip. */
const COLUMN_MIN_WIDTH_ISSUE_TYPE = 140;
const COLUMN_MAX_WIDTH_ISSUE_TYPE = 200;
/** Tight fit for longest status label (PENDING_VALIDATION). */
const COLUMN_WIDTH_STATUS = 182;

type IssueTableColumn = {
  uid: string;
  /** Plain label for accessibility (`textValue`) and fallbacks */
  name: string;
  /** Optional two-line header (wraps naturally; avoids truncation in narrow columns) */
  header?: ReactNode;
};

const VALID_ISSUE_HEADER = <span className="aso-table-header-valid-stacked">Valid issue</span>;

const VALID_SUGGESTION_HEADER = (
  <span className="aso-table-header-valid-stacked">Valid suggestion</span>
);

const TABLE_COLUMNS_TAIL: IssueTableColumn[] = [
  { uid: 'status', name: 'Status' },
  { uid: 'validationIssue', name: 'Valid issue', header: VALID_ISSUE_HEADER },
  { uid: 'validationFix', name: 'Valid suggestion', header: VALID_SUGGESTION_HEADER },
  /** Avoid uid `info` — can interact poorly with collection/table internals in some builds. */
  { uid: 'suggestionInfo', name: 'Info' },
];

const DEFAULT_TABLE_COLUMNS: IssueTableColumn[] = [
  { uid: 'urlLabel', name: 'URL' },
  { uid: 'issueTypeLabel', name: 'Issue type' },
  ...TABLE_COLUMNS_TAIL,
];

const BROKEN_LINKS_TABLE_COLUMNS: IssueTableColumn[] = [
  { uid: 'urlFromLabel', name: 'URL From' },
  { uid: 'urlToLabel', name: 'URL To' },
  ...TABLE_COLUMNS_TAIL,
];

/** Truncates with ellipsis; tooltip with full text only when overflow (longer than column). */
function IssueTypeCell({ text }: { text: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const el = spanRef.current;
    if (!el) return;
    const measure = () => {
      setOverflow(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  const body = (
    <span ref={spanRef} className="aso-issue-type-cell-text">
      {text}
    </span>
  );

  if (!overflow) {
    return <div className="aso-issue-type-cell">{body}</div>;
  }

  return (
    <div className="aso-issue-type-cell">
      <TooltipTrigger delay={0}>
        <span className="aso-issue-type-cell-trigger" tabIndex={0}>
          {body}
        </span>
        <Tooltip placement="top">{text}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}

function ResourceLinkCell({
  display,
  suggestionId,
  justCopiedId,
  copyUrl,
  openUrl,
  openHref,
}: {
  display: string;
  suggestionId: string;
  justCopiedId: string | null;
  copyUrl: (url: string, id: string) => Promise<void>;
  openUrl: (url: string) => void;
  openHref: string | null;
}) {
  const canOpen = Boolean(openHref && /^https?:\/\//i.test(openHref));
  return (
    <div className="aso-url-table-cell">
      <MenuTrigger>
        <ActionButton
          isQuiet
          width="100%"
          UNSAFE_className="aso-url-action-button"
          UNSAFE_style={{ justifyContent: 'flex-start', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {display}
        </ActionButton>
        <Menu
          onAction={(key) => {
            if (key === 'copy') void copyUrl(display, suggestionId);
            if (key === 'open' && openHref) openUrl(openHref);
          }}
          disabledKeys={!canOpen ? ['open'] : []}
        >
          <Item key="copy" textValue="Copy URL">
            {justCopiedId === suggestionId ? 'Copied!' : 'Copy URL'}
          </Item>
          <Item key="open" textValue="Open in new tab">
            Open in new tab
          </Item>
        </Menu>
      </MenuTrigger>
    </div>
  );
}

export function SuggestionList({
  suggestions,
  loading,
  error,
  onValidate,
  validating = false,
  validationResultBySuggestionId = {},
  validatingSuggestionIds = new Set(),
  opportunity = null,
  opportunityTypeId,
  onUpdateStatus,
  updatingStatus = false,
}: SuggestionListProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | SuggestionStatus>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [updateStatusValue, setUpdateStatusValue] = useState<SuggestionStatus>('PENDING_VALIDATION');
  const [justCopiedId, setJustCopiedId] = useState<string | null>(null);

  const isBrokenInternalLinks = opportunityTypeId === 'broken-internal-links';
  const tableColumns = useMemo(
    () => (isBrokenInternalLinks ? BROKEN_LINKS_TABLE_COLUMNS : DEFAULT_TABLE_COLUMNS),
    [isBrokenInternalLinks]
  );

  useEffect(() => {
    setSortColumn(null);
  }, [opportunityTypeId]);

  const byStatus =
    statusFilter === 'all'
      ? suggestions
      : suggestions.filter((s) => s.status === statusFilter);

  const tableRows: TableRowData[] = useMemo(() => {
    return byStatus.map((s) => ({
      id: s.id,
      suggestion: s,
      urlLabel: suggestionSummary(s),
      issueTypeLabel: getIssueTypeLabel(s as SharedSuggestion),
      urlFromLabel: isBrokenInternalLinks
        ? getUrlFromDisplay(s as SharedSuggestion)
        : '',
      urlToLabel: isBrokenInternalLinks ? getUrlToDisplay(s as SharedSuggestion) : '',
      status: s.status ?? '',
      result: validationResultBySuggestionId[s.id],
      isValidating: validatingSuggestionIds.has(s.id),
    }));
  }, [
    byStatus,
    validationResultBySuggestionId,
    validatingSuggestionIds,
    isBrokenInternalLinks,
  ]);

  const sorted = useMemo(() => {
    if (!sortColumn) return tableRows;
    return [...tableRows].sort((a, b) => {
      let cmp = 0;
      if (sortColumn === 'url') cmp = a.urlLabel.localeCompare(b.urlLabel);
      else if (sortColumn === 'issue_type') cmp = a.issueTypeLabel.localeCompare(b.issueTypeLabel);
      else if (sortColumn === 'url_from') cmp = a.urlFromLabel.localeCompare(b.urlFromLabel);
      else if (sortColumn === 'url_to') cmp = a.urlToLabel.localeCompare(b.urlToLabel);
      else if (sortColumn === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortColumn === 'validationIssue') {
        cmp =
          validationOutcomeSortKey(a.result, 'issue') -
          validationOutcomeSortKey(b.result, 'issue');
      } else if (sortColumn === 'validationFix') {
        cmp =
          validationOutcomeSortKey(a.result, 'fix') - validationOutcomeSortKey(b.result, 'fix');
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [tableRows, sortColumn, sortDirection]);

  const selectedIds = useMemo(() => {
    if (selectedKeys === 'all') return new Set(sorted.map((r) => r.id));
    if (selectedKeys instanceof Set) return new Set([...selectedKeys].map(String));
    return new Set<string>();
  }, [selectedKeys, sorted]);
  const someSelected = selectedIds.size > 0;

  const handleSelectionChange = useCallback((keys: Selection) => {
    setSelectedKeys(keys);
  }, []);

  const handleValidate = useCallback(() => {
    if (onValidate && someSelected) onValidate([...selectedIds]);
  }, [onValidate, someSelected, selectedIds]);

  const handleApplyUpdateStatus = useCallback(async () => {
    if (onUpdateStatus && someSelected) {
      await onUpdateStatus([...selectedIds], updateStatusValue);
    }
  }, [onUpdateStatus, someSelected, selectedIds, updateStatusValue]);

  const hreflangBulkSelect = isHreflangOpportunity(opportunity);

  const selectValidIds = useMemo(
    () =>
      sorted
        .filter((row) => row.result?.validation_status === 'real_issue')
        .map((row) => row.id),
    [sorted]
  );

  const selectInvalidIds = useMemo(
    () =>
      sorted
        .filter((row) => row.result?.validation_status === 'false_positive')
        .map((row) => row.id),
    [sorted]
  );

  const handleSelectAllValid = useCallback(() => {
    setSelectedKeys(new Set(selectValidIds));
  }, [selectValidIds]);

  const handleSelectAllInvalid = useCallback(() => {
    setSelectedKeys(new Set(selectInvalidIds));
  }, [selectInvalidIds]);

  const isUrlLike = (value: string) => /^https?:\/\//i.test(value.trim());

  const copyUrl = useCallback(async (url: string, suggestionId: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setJustCopiedId(suggestionId);
      setTimeout(() => setJustCopiedId(null), 1500);
    } catch {
      // ignore
    }
  }, []);

  const openUrl = useCallback((url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  // suppress unused variable warnings for sort state setters
  void setSortColumn;
  void setSortDirection;

  if (loading) {
    return (
      <Flex direction="column" gap="size-150" flex={1} minHeight={0} width="100%">
        <Heading level={2} margin={0}>Issues</Heading>
        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>Loading suggestions…</Text>
      </Flex>
    );
  }

  if (error) {
    return (
      <Flex direction="column" gap="size-150" flex={1} minHeight={0} width="100%">
        <Heading level={2} margin={0}>Issues</Heading>
        <Text UNSAFE_style={{ color: 'var(--spectrum-semantic-negative-color-default)' }}>{error}</Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="size-200" flex={1} minHeight={0} width="100%">
      <Flex direction="row" wrap gap="size-200" alignItems="start" justifyContent="space-between">
        <Flex direction="column" gap="size-100" alignItems="start">
          <Heading level={2} margin={0}>
            Issues{' '}
            <Text UNSAFE_style={{ fontWeight: 400, color: 'var(--spectrum-global-color-gray-600)' }}>
              ({sorted.length}
              {statusFilter !== 'all' ? ` of ${suggestions.length}` : ''})
            </Text>
          </Heading>
          {suggestions.length > 0 && onValidate && (
            <Button
              variant="accent"
              onPress={handleValidate}
              isDisabled={validating || !someSelected}
            >
              {validating ? 'Validating…' : `Validate${someSelected ? ` (${selectedIds.size})` : ''}`}
            </Button>
          )}
        </Flex>
        {suggestions.length > 0 && (
          <Flex gap="size-150" alignItems="center" wrap>
            <Picker
              label="Status"
              labelPosition="side"
              selectedKey={statusFilter}
              onSelectionChange={(k) => setStatusFilter(k as 'all' | SuggestionStatus)}
              width="size-4600"
            >
              {STATUS_OPTIONS.map((opt) => (
                <Item key={opt.value}>{opt.label}</Item>
              ))}
            </Picker>
            {((onValidate && hreflangBulkSelect) || onUpdateStatus) && (
              <Flex gap="size-100" alignItems="center" wrap>
                {onValidate && hreflangBulkSelect && (
                  <>
                    <Button
                      variant="secondary"
                      onPress={handleSelectAllValid}
                      isDisabled={selectValidIds.length === 0}
                      aria-label="Select all suggestions validated as valid"
                    >
                      {`Select all valid${selectValidIds.length > 0 ? ` (${selectValidIds.length})` : ''}`}
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={handleSelectAllInvalid}
                      isDisabled={selectInvalidIds.length === 0}
                      aria-label="Select all suggestions validated as not valid"
                    >
                      {`Select all invalid${selectInvalidIds.length > 0 ? ` (${selectInvalidIds.length})` : ''}`}
                    </Button>
                  </>
                )}
                {onUpdateStatus && (
                  <>
                    <Picker
                      label="Update to"
                      labelPosition="side"
                      selectedKey={updateStatusValue}
                      onSelectionChange={(k) => setUpdateStatusValue(k as SuggestionStatus)}
                      width="size-4600"
                      isDisabled={updatingStatus || !someSelected}
                    >
                      {UPDATE_STATUS_OPTIONS.map((opt) => (
                        <Item key={opt.value}>{opt.label}</Item>
                      ))}
                    </Picker>
                    <Button
                      variant="secondary"
                      onPress={handleApplyUpdateStatus}
                      isDisabled={updatingStatus || !someSelected}
                    >
                      {updatingStatus ? 'Updating…' : 'Update'}
                    </Button>
                  </>
                )}
              </Flex>
            )}
          </Flex>
        )}
      </Flex>

      {sorted.length === 0 ? (
        <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>
          {suggestions.length === 0 ? 'No suggestions for this category.' : 'No issues match the current filters.'}
        </Text>
      ) : (
        <Flex
          direction="column"
          flex={1}
          minHeight={0}
          width="100%"
          UNSAFE_className="aso-suggestions-table-wrap"
        >
        <TableView
          aria-label="Issues table"
          selectionMode={onValidate ? 'multiple' : 'none'}
          selectedKeys={selectedKeys}
          onSelectionChange={handleSelectionChange}
          width="100%"
          height="100%"
          overflowMode="wrap"
          UNSAFE_className="aso-suggestions-table"
        >
          <TableHeader columns={tableColumns}>
            {(col) => {
              const isIconCol =
                col.uid === 'validationIssue' ||
                col.uid === 'validationFix' ||
                col.uid === 'suggestionInfo';
              const iconColWidth = {
                width: COLUMN_WIDTH_ICON,
                minWidth: COLUMN_WIDTH_ICON,
              };
              const issueTypeConstraints =
                col.uid === 'issueTypeLabel'
                  ? {
                      minWidth: COLUMN_MIN_WIDTH_ISSUE_TYPE,
                      maxWidth: COLUMN_MAX_WIDTH_ISSUE_TYPE,
                    }
                  : {};
              const linkColConstraints =
                col.uid === 'urlLabel' ||
                col.uid === 'urlFromLabel' ||
                col.uid === 'urlToLabel'
                  ? { minWidth: COLUMN_MIN_WIDTH_URL, align: 'start' as const }
                  : {};
              const statusConstraints =
                col.uid === 'status'
                  ? {
                      width: COLUMN_WIDTH_STATUS,
                      minWidth: COLUMN_WIDTH_STATUS,
                      maxWidth: COLUMN_WIDTH_STATUS,
                    }
                  : {};
              return (
                <Column
                  key={col.uid}
                  isRowHeader={col.uid === 'urlLabel' || col.uid === 'urlFromLabel'}
                  {...linkColConstraints}
                  {...issueTypeConstraints}
                  {...statusConstraints}
                  {...(isIconCol ? iconColWidth : {})}
                  textValue={typeof col.name === 'string' ? col.name : String(col.uid)}
                >
                  {col.header ?? col.name}
                </Column>
              );
            }}
          </TableHeader>
          <TableBody items={sorted}>
            {(item) => (
              <Row>
                {(columnKey) => {
                  if (columnKey === 'urlLabel') {
                    return (
                      <Cell>
                        <ResourceLinkCell
                          display={item.urlLabel}
                          suggestionId={item.id}
                          justCopiedId={justCopiedId}
                          copyUrl={copyUrl}
                          openUrl={openUrl}
                          openHref={isUrlLike(item.urlLabel) ? item.urlLabel : null}
                        />
                      </Cell>
                    );
                  }
                  if (columnKey === 'urlFromLabel') {
                    return (
                      <Cell>
                        <ResourceLinkCell
                          display={item.urlFromLabel}
                          suggestionId={item.id}
                          justCopiedId={justCopiedId}
                          copyUrl={copyUrl}
                          openUrl={openUrl}
                          openHref={getOpenHrefForUrlFrom(item.suggestion as SharedSuggestion)}
                        />
                      </Cell>
                    );
                  }
                  if (columnKey === 'urlToLabel') {
                    return (
                      <Cell>
                        <ResourceLinkCell
                          display={item.urlToLabel}
                          suggestionId={item.id}
                          justCopiedId={justCopiedId}
                          copyUrl={copyUrl}
                          openUrl={openUrl}
                          openHref={getOpenHrefForUrlTo(item.suggestion as SharedSuggestion, item.urlToLabel)}
                        />
                      </Cell>
                    );
                  }
                  if (columnKey === 'validationIssue') {
                    return (
                      <Cell>
                        <div className="aso-table-icon-cell-wrap">
                          <ValidationIconCellInner
                            suggestion={item.suggestion}
                            result={item.result}
                            mode="issue"
                            isValidating={item.isValidating}
                          />
                        </div>
                      </Cell>
                    );
                  }
                  if (columnKey === 'validationFix') {
                    return (
                      <Cell>
                        <div className="aso-table-icon-cell-wrap">
                          <ValidationIconCellInner
                            suggestion={item.suggestion}
                            result={item.result}
                            mode="fix"
                            isValidating={item.isValidating}
                          />
                        </div>
                      </Cell>
                    );
                  }
                  if (columnKey === 'suggestionInfo') {
                    return (
                      <Cell>
                        <div className="aso-table-icon-cell-wrap">
                          <DialogTrigger type="modal" isDismissable>
                            <ActionButton
                              isQuiet
                              aria-label="Suggestion details"
                              UNSAFE_className="suggestion-info-trigger-button"
                            >
                              ℹ
                            </ActionButton>
                            <Dialog size="L" isDismissable>
                              <SuggestionIdDialogContent
                                suggestion={item.suggestion}
                                opportunity={opportunity}
                              />
                            </Dialog>
                          </DialogTrigger>
                        </div>
                      </Cell>
                    );
                  }
                  if (columnKey === 'issueTypeLabel') {
                    return (
                      <Cell>
                        <IssueTypeCell text={item.issueTypeLabel} />
                      </Cell>
                    );
                  }
                  if (columnKey === 'status') {
                    return (
                      <Cell>
                        <span className="aso-status-cell-text">{item.status}</span>
                      </Cell>
                    );
                  }
                  const value = item[columnKey as keyof TableRowData];
                  return <Cell>{String(value ?? '')}</Cell>;
                }}
              </Row>
            )}
          </TableBody>
        </TableView>
        </Flex>
      )}

    </Flex>
  );
}
