'use client';

import { getTrimmedPageUrlFromData } from '@validator-shared/suggestion/pageUrl';

export interface ValidationResultItem {
  suggestionId: string;
  validation_status: string;
  explanation?: string;
  /** For real_issue: whether the LLM validated the suggested fix as correct. */
  fixValidated?: boolean;
  /** LLM explanation for fix validation. */
  fixExplanation?: string;
}

interface Suggestion {
  id: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

function suggestionSummary(s: Suggestion): string {
  const d = s.data;
  if (!d || typeof d !== 'object') return s.id;
  const url = getTrimmedPageUrlFromData(d);
  if (url) return url;
  const type = (d.checkType ?? d.type) as string | undefined;
  if (type) return type;
  return s.id;
}

function labelForStatus(status: string): string {
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

interface ValidationSummaryProps {
  results: ValidationResultItem[];
  suggestions: Suggestion[];
}

export function ValidationSummary({ results, suggestions }: ValidationSummaryProps) {
  const byStatus = new Map<string, number>();
  for (const r of results) {
    const s = r.validation_status || 'unknown';
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  const suggestionMap = new Map(suggestions.map((s) => [s.id, s]));

  return (
    <section className="validation-summary" aria-label="Validation summary">
      <h3 className="validation-summary-title">Validation summary</h3>
      <div className="validation-summary-counts">
        {Array.from(byStatus.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([status, count]) => (
            <span key={status} className="validation-summary-badge">
              <span className="validation-summary-badge-label">{labelForStatus(status)}</span>
              <span className="validation-summary-badge-count">{count}</span>
            </span>
          ))}
      </div>
      <div className="validation-summary-table-wrap">
        <table className="validation-summary-table">
          <thead>
            <tr>
              <th scope="col">Issue</th>
              <th scope="col">Result</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const suggestion = suggestionMap.get(r.suggestionId);
              const summary = suggestion ? suggestionSummary(suggestion) : r.suggestionId;
              return (
                <tr key={r.suggestionId}>
                  <td className="validation-summary-cell-summary">{summary}</td>
                  <td>
                    <span className={`validation-summary-status validation-summary-status-${r.validation_status.replace(/_/g, '-')}`}>
                      {labelForStatus(r.validation_status)}
                    </span>
                  </td>
                  <td className="validation-summary-cell-details">
                    {r.explanation ?? '—'}
                    {r.validation_status === 'real_issue' && r.fixValidated !== undefined && (
                      <span className="validation-summary-fix">
                        {' '}
                        {r.fixValidated ? '✓ Fix validated' : '✗ Fix not validated'}
                        {r.fixExplanation ? `: ${r.fixExplanation}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
