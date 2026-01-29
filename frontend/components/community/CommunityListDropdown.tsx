'use client';

import { useState, useRef, useEffect } from 'react';
import { Community } from '@/components/CommunityVisualization';
import { useCommunityStore } from '@/lib/community-store';

// Community colors - matching CommunityVisualization
const communityColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
];

interface CommunityListDropdownProps {
  communities: Community[];
  onFocusCommunity?: (communityId: string | number) => void;
}

export default function CommunityListDropdown({
  communities,
  onFocusCommunity,
}: CommunityListDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const {
    selectedCommunityId,
    highlightedCommunityId,
    selectCommunity,
    setHighlightedCommunity,
  } = useCommunityStore();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCommunityClick = (community: Community) => {
    selectCommunity(community);
    onFocusCommunity?.(community.communityId);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
      >
        <svg
          className="w-4 h-4 text-gray-500 dark:text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
          />
        </svg>
        <span className="text-gray-700 dark:text-gray-300">Communities</span>
        <span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-xs font-medium">
          {communities.length}
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
          {communities.length === 0 ? (
            <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 text-center">
              No communities detected
            </div>
          ) : (
            <div className="py-1">
              {communities.map((community, index) => {
                const isSelected = String(selectedCommunityId) === String(community.communityId);
                const isHighlighted = String(highlightedCommunityId) === String(community.communityId);

                return (
                  <button
                    key={community.communityId}
                    onClick={() => handleCommunityClick(community)}
                    onMouseEnter={() => setHighlightedCommunity(community.communityId)}
                    onMouseLeave={() => setHighlightedCommunity(null)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : isHighlighted
                        ? 'bg-gray-50 dark:bg-gray-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: communityColors[index % communityColors.length] }}
                    />
                    <span
                      className="text-sm text-gray-900 dark:text-white truncate flex-1"
                      title={community.title || `Community ${community.communityId}`}
                    >
                      {community.title || `Community ${community.communityId}`}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {community.memberCount} members
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
