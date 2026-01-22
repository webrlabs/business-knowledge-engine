'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import Pagination from '@/components/Pagination';

interface AuditLog {
  id: string;
  timestamp: string;
  action: 'approve' | 'reject' | 'create' | 'update' | 'delete';
  entityType: 'entity' | 'relationship' | 'document';
  entityId: string;
  userId: string;
  userEmail: string;
  userName: string;
  details: {
    entityName?: string;
    entityCategory?: string;
    confidenceScore?: number;
    reason?: string;
  };
  immutable: boolean;
}

export default function AuditLogPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    action: '',
    entityType: '',
    entityId: ''
  });

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.action) params.append('action', filter.action);
      if (filter.entityType) params.append('entityType', filter.entityType);
      if (filter.entityId) params.append('entityId', filter.entityId);

      const response = await authFetch(`${API_BASE_URL}/api/audit/logs?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch audit logs');

      const data = await response.json();
      setLogs(data.logs || []);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [authFetch, filter]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }
    fetchAuditLogs();
  }, [fetchAuditLogs, isAuthenticated, router]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'approve':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'reject':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'create':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'update':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'delete':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getEntityTypeBadgeColor = (entityType: string) => {
    switch (entityType) {
      case 'entity':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'relationship':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'document':
        return 'bg-teal-100 text-teal-800 border-teal-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Pagination calculations
  const totalItems = logs.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedLogs = logs.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top of table
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1); // Reset to first page when page size changes
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 mb-6 p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Audit Log</h2>
            <p className="text-gray-600">
              Immutable record of all entity approval, rejection, and modification actions
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600">Total Entries</div>
            <div className="text-2xl font-bold text-gray-900">{logs.length}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="action-filter" className="block text-sm font-medium text-gray-700 mb-2">
              Action
            </label>
            <select
              id="action-filter"
              value={filter.action}
              onChange={(e) => setFilter({ ...filter, action: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Actions</option>
              <option value="approve">Approve</option>
              <option value="reject">Reject</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
            </select>
          </div>

          <div>
            <label htmlFor="entity-type-filter" className="block text-sm font-medium text-gray-700 mb-2">
              Entity Type
            </label>
            <select
              id="entity-type-filter"
              value={filter.entityType}
              onChange={(e) => setFilter({ ...filter, entityType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="entity">Entity</option>
              <option value="relationship">Relationship</option>
              <option value="document">Document</option>
            </select>
          </div>

          <div>
            <label htmlFor="entity-id-filter" className="block text-sm font-medium text-gray-700 mb-2">
              Entity ID
            </label>
            <input
              type="text"
              id="entity-id-filter"
              value={filter.entityId}
              onChange={(e) => setFilter({ ...filter, entityId: e.target.value })}
              placeholder="Enter entity ID..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {(filter.action || filter.entityType || filter.entityId) && (
          <button
            onClick={() => setFilter({ action: '', entityType: '', entityId: '' })}
            className="mt-4 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Audit Log Table */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No audit logs found</h3>
            <p className="mt-2 text-gray-600">
              {filter.action || filter.entityType || filter.entityId
                ? 'Try adjusting your filters to see more results.'
                : 'Audit logs will appear here once entities are approved or rejected.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-300">
              <thead className="bg-gray-100 border-b-2 border-gray-300">
                <tr>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Action
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Entity Type
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Entity ID
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    User
                  </th>
                  <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedLogs.map((log, index) => (
                  <tr
                    key={log.id}
                    className={`
                      transition-colors duration-150
                      ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                      hover:bg-blue-50
                    `}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 align-top">
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap align-top">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-md border ${getActionBadgeColor(log.action)}`}>
                        {log.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap align-top">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-md border ${getEntityTypeBadgeColor(log.entityType)}`}>
                        {log.entityType}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 align-top">
                      {log.entityId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap align-top">
                      <div className="text-sm font-medium text-gray-900">{log.userName}</div>
                      <div className="text-xs text-gray-500">{log.userEmail}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 align-top max-w-xs">
                      {log.details.entityName && (
                        <div><span className="font-medium">Entity:</span> {log.details.entityName}</div>
                      )}
                      {log.details.entityCategory && (
                        <div><span className="font-medium">Category:</span> {log.details.entityCategory}</div>
                      )}
                      {log.details.confidenceScore !== undefined && (
                        <div><span className="font-medium">Confidence:</span> {(log.details.confidenceScore * 100).toFixed(0)}%</div>
                      )}
                      {log.details.reason && (
                        <div className="mt-1 text-gray-600 italic">&quot;{log.details.reason}&quot;</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {!loading && logs.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={totalItems}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                pageSizeOptions={[10, 25, 50, 100]}
              />
            )}
          </div>
        )}
      </div>

      {/* Info Box */}
      {logs.length > 0 && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div className="ml-3">
              <h4 className="text-sm font-medium text-blue-900">Audit Log Information</h4>
              <ul className="mt-2 text-sm text-blue-700 list-disc list-inside space-y-1">
                <li>All audit logs are <strong>immutable</strong> and cannot be modified or deleted</li>
                <li>Logs include Microsoft Entra ID user claims for full traceability</li>
                <li>Records are retained according to compliance and regulatory requirements</li>
                <li>Each entry captures timestamp, action, entity details, and user identity</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
