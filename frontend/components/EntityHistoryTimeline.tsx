'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

/**
 * Entity version type matching backend response
 */
export interface EntityVersion {
  id: string;
  name: string;
  type: string;
  description?: string;
  validFrom?: string;
  validTo?: string;
  supersededBy?: string;
  supersedes?: string;
  temporalStatus: 'current' | 'superseded' | 'pending' | 'expired';
  versionSequence: number;
  isCurrentVersion: boolean;
  createdAt?: string;
  // Additional metadata
  changeReason?: string;
  changedBy?: string;
}

/**
 * Entity history response from API
 */
export interface EntityHistoryResponse {
  entityId: string;
  name: string | null;
  type: string | null;
  versions: EntityVersion[];
  currentVersion: EntityVersion | null;
}

interface EntityHistoryTimelineProps {
  /** Entity ID to fetch history for */
  entityId: string;
  /** Optional callback when a version is selected */
  onVersionSelect?: (version: EntityVersion) => void;
  /** Optional selected version ID */
  selectedVersionId?: string;
  /** Whether the component is in compact mode */
  compact?: boolean;
  /** Maximum versions to display (default: all) */
  maxVersions?: number;
}

/**
 * Status colors and icons for temporal states
 */
const StatusConfig: Record<EntityVersion['temporalStatus'], {
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  label: string;
}> = {
  current: {
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-500',
    label: 'Current',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  superseded: {
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-400',
    label: 'Superseded',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
      </svg>
    ),
  },
  pending: {
    color: 'text-amber-700',
    bgColor: 'bg-amber-100',
    borderColor: 'border-amber-500',
    label: 'Pending',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  expired: {
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-500',
    label: 'Expired',
    icon: (
      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
    ),
  },
};

/**
 * Format a date string for display
 */
function formatDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

/**
 * Format a date string for short display (compact mode)
 */
function formatDateShort(dateString?: string): string {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Calculate relative time from a date
 */
function getRelativeTime(dateString?: string): string {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  } catch {
    return '';
  }
}

/**
 * EntityHistoryTimeline Component (F2.3.6)
 *
 * A timeline visualization component that displays the version history of an entity.
 * Shows all versions with their temporal status, validity dates, and change tracking.
 *
 * Features:
 * - Visual timeline with version nodes
 * - Status indicators (current, superseded, pending, expired)
 * - Expandable version details
 * - Version comparison capability
 * - Responsive and accessible design
 */
export default function EntityHistoryTimeline({
  entityId,
  onVersionSelect,
  selectedVersionId,
  compact = false,
  maxVersions,
}: EntityHistoryTimelineProps) {
  const authFetch = useAuthFetch();
  const [history, setHistory] = useState<EntityHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  // Fetch entity history from API
  const fetchHistory = useCallback(async () => {
    if (!entityId) {
      setError('No entity ID provided');
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await authFetch(`${API_BASE_URL}/api/entities/${encodeURIComponent(entityId)}/history`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Entity not found');
        }
        throw new Error(`Failed to fetch entity history: ${response.status}`);
      }

      const data: EntityHistoryResponse = await response.json();
      setHistory(data);
    } catch (err) {
      console.error('Error fetching entity history:', err);
      setError(err instanceof Error ? err.message : 'Failed to load entity history');
    } finally {
      setIsLoading(false);
    }
  }, [entityId, authFetch]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Toggle version expansion
  const toggleVersionExpansion = (versionId: string) => {
    setExpandedVersions(prev => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  // Handle version selection
  const handleVersionClick = (version: EntityVersion) => {
    if (onVersionSelect) {
      onVersionSelect(version);
    }
    if (!compact) {
      toggleVersionExpansion(version.id);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse" role="status" aria-label="Loading entity history">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/2"></div>
          </div>
        </div>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-6 h-6 bg-gray-200 rounded-full"></div>
          <div className="flex-1">
            <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
            <div className="h-3 bg-gray-200 rounded w-1/3"></div>
          </div>
        </div>
        <span className="sr-only">Loading entity history...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700"
        role="alert"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">Error loading history</span>
        </div>
        <p className="mt-1 text-sm">{error}</p>
        <button
          onClick={fetchHistory}
          className="mt-2 text-sm text-red-800 underline hover:no-underline"
        >
          Try again
        </button>
      </div>
    );
  }

  // No history available
  if (!history || history.versions.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        <svg className="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm">No version history available</p>
      </div>
    );
  }

  // Determine versions to display
  const versions = maxVersions
    ? history.versions.slice(-maxVersions)
    : history.versions;

  // Compact view
  if (compact) {
    return (
      <div className="space-y-2" role="list" aria-label="Entity version history">
        {/* Header */}
        <div className="flex items-center justify-between text-sm text-gray-600 mb-3">
          <span className="font-medium">{history.name || 'Entity'}</span>
          <span className="text-xs">{history.versions.length} version{history.versions.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Compact timeline */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {versions.map((version, index) => {
            const config = StatusConfig[version.temporalStatus];
            const isSelected = selectedVersionId === version.id;

            return (
              <button
                key={version.id}
                onClick={() => handleVersionClick(version)}
                className={`
                  flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-xs
                  transition-all cursor-pointer border
                  ${isSelected
                    ? `${config.bgColor} ${config.borderColor} ${config.color} ring-2 ring-offset-1 ring-blue-400`
                    : `bg-white border-gray-200 text-gray-600 hover:${config.bgColor} hover:${config.borderColor}`
                  }
                `}
                title={`Version ${version.versionSequence}: ${config.label} - ${formatDateShort(version.validFrom)}`}
                aria-label={`Version ${version.versionSequence}, ${config.label}`}
                aria-pressed={isSelected}
              >
                <span className={config.color}>{config.icon}</span>
                <span>v{version.versionSequence}</span>
              </button>
            );
          })}
        </div>

        {maxVersions && history.versions.length > maxVersions && (
          <p className="text-xs text-gray-400 text-center">
            Showing {maxVersions} of {history.versions.length} versions
          </p>
        )}
      </div>
    );
  }

  // Full timeline view
  return (
    <div className="space-y-4" role="list" aria-label="Entity version history">
      {/* Header */}
      <div className="border-b border-gray-200 pb-3">
        <h3 className="text-lg font-semibold text-gray-900">
          {history.name || 'Entity'} History
        </h3>
        <p className="text-sm text-gray-500">
          {history.type && <span className="text-gray-600">{history.type}</span>}
          {history.type && ' • '}
          {history.versions.length} version{history.versions.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" aria-hidden="true" />

        {/* Version items */}
        <div className="space-y-4">
          {versions.map((version, index) => {
            const config = StatusConfig[version.temporalStatus];
            const isExpanded = expandedVersions.has(version.id);
            const isSelected = selectedVersionId === version.id;
            const isFirst = index === 0;
            const isLast = index === versions.length - 1;

            return (
              <div
                key={version.id}
                role="listitem"
                className={`
                  relative pl-10 transition-all
                  ${isSelected ? 'bg-blue-50 -mx-2 px-2 py-2 rounded-lg' : ''}
                `}
              >
                {/* Timeline node */}
                <div
                  className={`
                    absolute left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center
                    ${config.bgColor} ${config.borderColor} ${config.color}
                    ${version.isCurrentVersion ? 'ring-2 ring-offset-2 ring-green-300' : ''}
                  `}
                  aria-hidden="true"
                >
                  {config.icon}
                </div>

                {/* Version card */}
                <div
                  className={`
                    bg-white border rounded-lg shadow-sm transition-all
                    ${isSelected ? 'border-blue-300 shadow-md' : 'border-gray-200 hover:border-gray-300 hover:shadow'}
                    ${onVersionSelect ? 'cursor-pointer' : ''}
                  `}
                  onClick={() => handleVersionClick(version)}
                  role={onVersionSelect ? 'button' : undefined}
                  tabIndex={onVersionSelect ? 0 : undefined}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleVersionClick(version);
                    }
                  }}
                >
                  {/* Card header */}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">
                        Version {version.versionSequence}
                      </span>
                      <span className={`
                        inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                        ${config.bgColor} ${config.color}
                      `}>
                        {config.icon}
                        {config.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{formatDateShort(version.validFrom)}</span>
                      {!compact && (
                        <svg
                          className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Card body (expanded) */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-gray-100">
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 text-sm">
                        <div>
                          <dt className="text-gray-500">Name</dt>
                          <dd className="text-gray-900 font-medium">{version.name}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Type</dt>
                          <dd className="text-gray-900">{version.type}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Valid From</dt>
                          <dd className="text-gray-900">{formatDate(version.validFrom)}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Valid To</dt>
                          <dd className="text-gray-900">{version.validTo ? formatDate(version.validTo) : 'Present'}</dd>
                        </div>
                        {version.description && (
                          <div className="col-span-2">
                            <dt className="text-gray-500">Description</dt>
                            <dd className="text-gray-900 mt-1">{version.description}</dd>
                          </div>
                        )}
                        {version.changeReason && (
                          <div className="col-span-2">
                            <dt className="text-gray-500">Change Reason</dt>
                            <dd className="text-gray-900 mt-1">{version.changeReason}</dd>
                          </div>
                        )}
                        {version.changedBy && (
                          <div>
                            <dt className="text-gray-500">Changed By</dt>
                            <dd className="text-gray-900">{version.changedBy}</dd>
                          </div>
                        )}
                        <div>
                          <dt className="text-gray-500">Entity ID</dt>
                          <dd className="text-gray-600 text-xs font-mono truncate" title={version.id}>
                            {version.id}
                          </dd>
                        </div>
                      </dl>

                      {/* Version links */}
                      {(version.supersedes || version.supersededBy) && (
                        <div className="mt-4 pt-3 border-t border-gray-100">
                          <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">Version Chain</h4>
                          <div className="flex items-center gap-4 text-sm">
                            {version.supersedes && (
                              <span className="text-gray-600">
                                <span className="text-gray-400">← Previous: </span>
                                <span className="font-mono text-xs">{version.supersedes.slice(0, 8)}...</span>
                              </span>
                            )}
                            {version.supersededBy && (
                              <span className="text-gray-600">
                                <span className="text-gray-400">Next → </span>
                                <span className="font-mono text-xs">{version.supersededBy.slice(0, 8)}...</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Relative time indicator */}
                {version.validFrom && (
                  <div className="absolute right-0 top-3 text-xs text-gray-400">
                    {getRelativeTime(version.validFrom)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      {maxVersions && history.versions.length > maxVersions && (
        <p className="text-xs text-gray-400 text-center mt-4">
          Showing {maxVersions} of {history.versions.length} versions
        </p>
      )}
    </div>
  );
}
