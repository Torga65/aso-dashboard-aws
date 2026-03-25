import { LoadingSpinner } from "./LoadingSpinner";
import { ErrorMessage } from "./ErrorMessage";
import { EmptyState } from "./EmptyState";

interface DataBoundaryProps<T> {
  isLoading: boolean;
  error: string | null;
  data: T;
  /** Predicate to determine whether data is empty. Defaults to array length check. */
  isEmpty?: (data: T) => boolean;
  /** Custom loading label. */
  loadingLabel?: string;
  /** Props forwarded to EmptyState. */
  emptyTitle?: string;
  emptyMessage?: string;
  emptyIcon?: React.ReactNode;
  emptyAction?: React.ReactNode;
  /** Retry callback forwarded to ErrorMessage. */
  onRetry?: () => void;
  /** Rendered when data is present and not loading or errored. */
  children: (data: NonNullable<T>) => React.ReactNode;
}

/**
 * Generic render-prop wrapper that handles loading / error / empty states
 * so individual pages don't need to repeat the same conditional logic.
 *
 * Usage:
 *   <DataBoundary isLoading={isLoading} error={error} data={customers}>
 *     {(customers) => <CustomerTable customers={customers} />}
 *   </DataBoundary>
 */
export function DataBoundary<T>({
  isLoading,
  error,
  data,
  isEmpty,
  loadingLabel,
  emptyTitle,
  emptyMessage,
  emptyIcon,
  emptyAction,
  onRetry,
  children,
}: DataBoundaryProps<T>) {
  if (isLoading) {
    return <LoadingSpinner label={loadingLabel} />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={onRetry} />;
  }

  const empty = isEmpty
    ? isEmpty(data)
    : Array.isArray(data)
      ? data.length === 0
      : data == null;

  if (empty) {
    return (
      <EmptyState
        title={emptyTitle}
        message={emptyMessage}
        icon={emptyIcon}
        action={emptyAction}
      />
    );
  }

  return <>{children(data as NonNullable<T>)}</>;
}
