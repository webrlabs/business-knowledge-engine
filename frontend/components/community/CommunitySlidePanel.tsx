'use client';

import { useEffect, useRef } from 'react';
import { useCommunityStore } from '@/lib/community-store';
import { CommunityMember } from '@/components/CommunityVisualization';

// Entity type colors
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

interface CommunitySlidePanelProps {
  onMemberClick?: (member: CommunityMember) => void;
}

export default function CommunitySlidePanel({ onMemberClick }: CommunitySlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { selectedCommunity, isPanelOpen, closePanel, selectMember } = useCommunityStore();

  // Close on ESC key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPanelOpen) {
        closePanel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPanelOpen, closePanel]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isPanelOpen &&
        panelRef.current &&
        !panelRef.current.contains(event.target as Node)
      ) {
        closePanel();
      }
    };

    // Use setTimeout to avoid closing immediately when clicking to open
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPanelOpen, closePanel]);

  const handleMemberClick = (member: CommunityMember) => {
    selectMember(member);
    onMemberClick?.(member);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/20 transition-opacity duration-300 ${
          isPanelOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closePanel}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`absolute top-0 right-0 h-full w-full max-w-[400px] bg-white dark:bg-gray-800 shadow-2xl transform transition-transform duration-300 ease-in-out overflow-hidden ${
          isPanelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {selectedCommunity && (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-900/50">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate pr-2">
                {selectedCommunity.title || `Community ${selectedCommunity.communityId}`}
              </h3>
              <button
                onClick={closePanel}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
                aria-label="Close panel"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Summary */}
              {selectedCommunity.summary && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    Summary
                  </h4>
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                    {selectedCommunity.summary}
                  </p>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
                  <p className="text-xl font-bold text-blue-700 dark:text-blue-300">
                    {selectedCommunity.memberCount}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">Members</p>
                </div>
                {selectedCommunity.relationshipCount !== undefined && (
                  <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                    <p className="text-xl font-bold text-purple-700 dark:text-purple-300">
                      {selectedCommunity.relationshipCount}
                    </p>
                    <p className="text-xs text-purple-600 dark:text-purple-400">Relationships</p>
                  </div>
                )}
              </div>

              {/* Type Distribution */}
              {selectedCommunity.typeCounts && Object.keys(selectedCommunity.typeCounts).length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Type Distribution
                  </h4>
                  <div className="space-y-1.5">
                    {Object.entries(selectedCommunity.typeCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => (
                        <div key={type} className="flex items-center gap-2">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: entityTypeColors[type] || '#64748B' }}
                          />
                          <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{type}</span>
                          <span className="text-xs font-medium text-gray-900 dark:text-white">{count}</span>
                          <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                backgroundColor: entityTypeColors[type] || '#64748B',
                                width: `${(count / selectedCommunity.memberCount) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Key Entities */}
              {selectedCommunity.keyEntities && selectedCommunity.keyEntities.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Key Entities
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCommunity.keyEntities.map((entity, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded-full"
                      >
                        {entity}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Members List */}
              {selectedCommunity.members && selectedCommunity.members.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                    Members ({selectedCommunity.members.length})
                  </h4>
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {selectedCommunity.members.map((member) => (
                      <button
                        key={member.id}
                        onClick={() => handleMemberClick(member)}
                        className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-2"
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: entityTypeColors[member.type] || '#64748B' }}
                        />
                        <span className="text-xs text-gray-900 dark:text-white truncate flex-1">
                          {member.name}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                          {member.type}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {selectedCommunity.generatedAt && (
              <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Generated: {new Date(selectedCommunity.generatedAt).toLocaleString()}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
