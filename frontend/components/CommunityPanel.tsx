'use client';

import { Community, CommunityMember } from './CommunityVisualization';

// Entity type colors (matching existing graph visualization)
const entityTypeColors: Record<string, string> = {
  Process: '#3B82F6',
  Task: '#10B981',
  Role: '#F59E0B',
  System: '#8B5CF6',
  DataAsset: '#EC4899',
  Form: '#06B6D4',
  Policy: '#EF4444',
  Procedure: '#14B8A6',
  Directive: '#F97316',
  Guide: '#6366F1',
};

interface CommunityPanelProps {
  community: Community | null;
  onClose?: () => void;
  onMemberClick?: (member: CommunityMember) => void;
}

export default function CommunityPanel({ community, onClose, onMemberClick }: CommunityPanelProps) {
  if (!community) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <svg
            className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p className="text-sm">Select a community to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {community.title || `Community ${community.communityId}`}
          </h3>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-6">
        {/* Summary */}
        {community.summary && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Summary
            </h4>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
              {community.summary}
            </p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">
              {community.memberCount}
            </p>
            <p className="text-sm text-blue-600 dark:text-blue-400">Members</p>
          </div>
          {community.relationshipCount !== undefined && (
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
              <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
                {community.relationshipCount}
              </p>
              <p className="text-sm text-purple-600 dark:text-purple-400">Relationships</p>
            </div>
          )}
        </div>

        {/* Dominant Type */}
        {community.dominantType && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Dominant Entity Type
            </h4>
            <div className="flex items-center">
              <div
                className="w-4 h-4 rounded-full mr-2"
                style={{ backgroundColor: entityTypeColors[community.dominantType] || '#64748B' }}
              />
              <span className="text-gray-900 dark:text-white font-medium">
                {community.dominantType}
              </span>
            </div>
          </div>
        )}

        {/* Type Distribution */}
        {community.typeCounts && Object.keys(community.typeCounts).length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Type Distribution
            </h4>
            <div className="space-y-2">
              {Object.entries(community.typeCounts)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center">
                    <div
                      className="w-3 h-3 rounded-full mr-2"
                      style={{ backgroundColor: entityTypeColors[type] || '#64748B' }}
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{type}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{count}</span>
                    <div className="ml-2 w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
                        style={{
                          backgroundColor: entityTypeColors[type] || '#64748B',
                          width: `${(count / community.memberCount) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Key Entities */}
        {community.keyEntities && community.keyEntities.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Key Entities
            </h4>
            <div className="flex flex-wrap gap-2">
              {community.keyEntities.map((entity, idx) => (
                <span
                  key={idx}
                  className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm rounded-full"
                >
                  {entity}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Members List */}
        {community.members && community.members.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Members ({community.members.length})
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {community.members.map((member) => (
                <button
                  key={member.id}
                  onClick={() => onMemberClick?.(member)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                >
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: entityTypeColors[member.type] || '#64748B' }}
                  />
                  <span className="text-sm text-gray-900 dark:text-white truncate flex-1">
                    {member.name}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {member.type}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Generated At */}
        {community.generatedAt && (
          <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Summary generated: {new Date(community.generatedAt).toLocaleString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
