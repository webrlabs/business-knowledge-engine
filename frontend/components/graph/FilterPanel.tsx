'use client';

import { useState, useEffect } from 'react';
import { useGraphStore, ConnectivityFilter } from '@/lib/graph-store';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import { NODE_COLORS, getNodeColor } from '@/lib/graph-constants';

interface FilterPanelProps {
  nodeTypesInData: string[];
  nodeTypeCounts: Record<string, number>;
  isOpen: boolean;
  onToggle: () => void;
}


interface Document {
  id: string;
  name: string;
}

export default function FilterPanel({
  nodeTypesInData,
  nodeTypeCounts,
  isOpen,
  onToggle,
}: FilterPanelProps) {
  const authFetch = useAuthFetch();
  const {
    selectedNodeTypes,
    selectedDocuments,
    connectivityFilter,
    confidenceThreshold,
    toggleNodeType,
    setDocumentFilter,
    setConnectivityFilter,
    setConfidenceThreshold,
    clearAllFilters,
  } = useGraphStore();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Fetch available documents
  useEffect(() => {
    const fetchDocuments = async () => {
      setLoadingDocs(true);
      try {
        const response = await authFetch(`${API_BASE_URL}/api/documents?limit=100`);
        if (response.ok) {
          const data = await response.json();
          setDocuments(
            (data.documents || data || []).map((doc: any) => ({
              id: doc.id,
              name: doc.name || doc.fileName || doc.id,
            }))
          );
        }
      } catch (error) {
        console.error('Error fetching documents:', error);
      } finally {
        setLoadingDocs(false);
      }
    };

    if (isOpen) {
      fetchDocuments();
    }
  }, [isOpen, authFetch]);

  const activeFilterCount =
    selectedNodeTypes.size +
    selectedDocuments.length +
    (connectivityFilter !== 'all' ? 1 : 0) +
    (confidenceThreshold > 0 ? 1 : 0);

  const handleDocumentSelect = (docId: string) => {
    const newDocs = selectedDocuments.includes(docId)
      ? selectedDocuments.filter((id) => id !== docId)
      : [...selectedDocuments, docId];
    setDocumentFilter(newDocs);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
      {/* Toggle Button */}
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-t-lg"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-0.5 rounded-full">
              {activeFilterCount}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Filter Content */}
      {isOpen && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-3 space-y-4">
          {/* Node Types */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
              Node Types
            </label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {nodeTypesInData.map((type) => (
                <label
                  key={type}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1.5 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedNodeTypes.has(type)}
                    onChange={() => toggleNodeType(type)}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                  />
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: getNodeColor(type) }}
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{type}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {nodeTypeCounts[type] || 0}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Connectivity Filter */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
              Connectivity
            </label>
            <div className="flex flex-col gap-1">
              {(['all', 'connected', 'isolated'] as ConnectivityFilter[]).map((option) => (
                <label
                  key={option}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1.5 rounded"
                >
                  <input
                    type="radio"
                    name="connectivity"
                    checked={connectivityFilter === option}
                    onChange={() => setConnectivityFilter(option)}
                    className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">
                    {option === 'all'
                      ? 'All Nodes'
                      : option === 'connected'
                      ? 'Connected Only'
                      : 'Isolated Only'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Confidence Threshold */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
              Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={confidenceThreshold * 100}
              onChange={(e) => setConfidenceThreshold(parseInt(e.target.value) / 100)}
              className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-1">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Document Filter */}
          {documents.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">
                Source Documents
              </label>
              {loadingDocs ? (
                <div className="flex items-center justify-center py-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {documents.slice(0, 20).map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1.5 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDocuments.includes(doc.id)}
                        onChange={() => handleDocumentSelect(doc.id)}
                        className="w-4 h-4 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                      />
                      <svg
                        className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                        {doc.name}
                      </span>
                    </label>
                  ))}
                  {documents.length > 20 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
                      +{documents.length - 20} more documents
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Clear All Button */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="w-full px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
