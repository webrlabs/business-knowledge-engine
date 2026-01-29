'use client';

import { useRouter } from 'next/navigation';
import { useGraphStore, EnhancedNodeDetails, RelatedEntity } from '@/lib/graph-store';
import { NODE_COLORS, getNodeColor } from '@/lib/graph-constants';

interface NodeDetailsPanelProps {
  details: EnhancedNodeDetails;
  onClose: () => void;
  onFocus?: (nodeId: string) => void;
  onFindPaths?: (nodeId: string) => void;
}


function RelationshipBadge({ direction }: { direction: 'incoming' | 'outgoing' }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
        direction === 'incoming'
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
          : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
      }`}
    >
      {direction === 'incoming' ? (
        <>
          <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          In
        </>
      ) : (
        <>
          Out
          <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </>
      )}
    </span>
  );
}

function RelatedEntityItem({
  entity,
  onSelect,
}: {
  entity: RelatedEntity;
  onSelect: (name: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(entity.name)}
      className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: getNodeColor(entity.type) }}
        />
        <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{entity.name}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">
          {entity.relationship}
        </span>
        <RelationshipBadge direction={entity.direction} />
      </div>
    </button>
  );
}

export default function NodeDetailsPanel({
  details,
  onClose,
  onFocus,
  onFindPaths,
}: NodeDetailsPanelProps) {
  const router = useRouter();
  const { setPathFromNode, setShowPathFinder } = useGraphStore();

  const handleAskAI = () => {
    const query = `Tell me about the ${details.type} "${details.name}". What are its dependencies and relationships?`;
    router.push(`/dashboard/query?q=${encodeURIComponent(query)}&context=graph&entityId=${details.id}`);
  };

  const handleCopyName = () => {
    navigator.clipboard.writeText(details.name);
  };

  const handleFindPathsFrom = () => {
    setPathFromNode(details.name);
    setShowPathFinder(true);
    if (onFindPaths) {
      onFindPaths(details.id);
    }
  };

  const handleRelatedEntitySelect = (name: string) => {
    // This will be handled by the parent component to select the node in the graph
    const selectEvent = new CustomEvent('graph:selectNode', { detail: { name } });
    window.dispatchEvent(selectEvent);
  };

  const incomingEntities = details.relatedEntities.filter((e) => e.direction === 'incoming');
  const outgoingEntities = details.relatedEntities.filter((e) => e.direction === 'outgoing');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-sm w-full max-h-[calc(100vh-200px)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-4 h-4 rounded-full flex-shrink-0"
            style={{ backgroundColor: getNodeColor(details.type) }}
          />
          <h4 className="font-semibold text-gray-900 dark:text-white truncate">{details.name}</h4>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Type and Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-1">Type</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{details.type}</p>
          </div>
          {details.confidence !== undefined && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-1">Confidence</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {Math.round(details.confidence * 100)}%
              </p>
            </div>
          )}
          {details.mentionCount !== undefined && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-1">Mentions</p>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{details.mentionCount}</p>
            </div>
          )}
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-1">Connections</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {details.relatedEntities.length}
            </p>
          </div>
        </div>

        {/* Description */}
        {details.description && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-1">Description</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">{details.description}</p>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          {onFocus && (
            <button
              onClick={() => onFocus(details.id)}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900 transition-colors"
            >
              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              Focus
            </button>
          )}
          <button
            onClick={handleFindPathsFrom}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-900/50 dark:text-purple-300 dark:hover:bg-purple-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            Find Paths
          </button>
          <button
            onClick={handleAskAI}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/50 dark:text-green-300 dark:hover:bg-green-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Ask AI
          </button>
          <button
            onClick={handleCopyName}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>
        </div>

        {/* Connections */}
        {details.relatedEntities.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Connections</p>
              <div className="flex gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{incomingEntities.length} in</span>
                <span>/</span>
                <span>{outgoingEntities.length} out</span>
              </div>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {outgoingEntities.slice(0, 10).map((entity, index) => (
                <RelatedEntityItem
                  key={`out-${index}-${entity.name}`}
                  entity={entity}
                  onSelect={handleRelatedEntitySelect}
                />
              ))}
              {incomingEntities.slice(0, 10).map((entity, index) => (
                <RelatedEntityItem
                  key={`in-${index}-${entity.name}`}
                  entity={entity}
                  onSelect={handleRelatedEntitySelect}
                />
              ))}
              {details.relatedEntities.length > 20 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-1">
                  +{details.relatedEntities.length - 20} more connections
                </p>
              )}
            </div>
          </div>
        )}

        {/* Source Documents */}
        {details.sourceDocuments.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 uppercase mb-2">Source Documents</p>
            <div className="space-y-1">
              {details.sourceDocuments.map((doc) => (
                <a
                  key={doc.id}
                  href={`/dashboard/documents/${doc.id}`}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate">
                    {doc.name}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
          <p className="font-mono truncate" title={details.id}>ID: {details.id}</p>
          {details.createdAt && (
            <p>Created: {new Date(details.createdAt).toLocaleDateString()}</p>
          )}
          {details.updatedAt && (
            <p>Updated: {new Date(details.updatedAt).toLocaleDateString()}</p>
          )}
        </div>
      </div>
    </div>
  );
}
