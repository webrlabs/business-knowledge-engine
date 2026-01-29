'use client';

import { Community } from '@/components/CommunityVisualization';
import { useCommunityStore } from '@/lib/community-store';

// Community colors - matching CommunityVisualization
const communityColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD',
  '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1',
];

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

interface LegendBarProps {
  communities: Community[];
  maxVisible?: number;
}

export default function LegendBar({ communities, maxVisible = 8 }: LegendBarProps) {
  const { colorMode, setHighlightedCommunity, selectCommunity } = useCommunityStore();

  // Get unique entity types from communities
  const entityTypes = new Set<string>();
  communities.forEach((community) => {
    if (community.typeCounts) {
      Object.keys(community.typeCounts).forEach((type) => entityTypes.add(type));
    }
    if (community.dominantType) {
      entityTypes.add(community.dominantType);
    }
  });

  if (colorMode === 'entityType') {
    const types = Array.from(entityTypes);
    const visibleTypes = types.slice(0, maxVisible);
    const remainingCount = types.length - maxVisible;

    return (
      <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2 max-w-md">
        {visibleTypes.map((type) => (
          <div
            key={type}
            className="flex items-center gap-1.5 text-xs"
          >
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: entityTypeColors[type] || '#64748B' }}
            />
            <span className="text-gray-600 dark:text-gray-400">{type}</span>
          </div>
        ))}
        {remainingCount > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            +{remainingCount} more
          </span>
        )}
      </div>
    );
  }

  // Community color mode
  const visibleCommunities = communities.slice(0, maxVisible);
  const remainingCount = communities.length - maxVisible;

  return (
    <div className="absolute bottom-4 left-4 z-10 flex flex-wrap items-center gap-2 max-w-md">
      {visibleCommunities.map((community, index) => (
        <button
          key={community.communityId}
          onClick={() => selectCommunity(community)}
          onMouseEnter={() => setHighlightedCommunity(community.communityId)}
          onMouseLeave={() => setHighlightedCommunity(null)}
          className="flex items-center gap-1.5 text-xs hover:opacity-80 transition-opacity cursor-pointer"
          title={community.title || `Community ${community.communityId}`}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: communityColors[index % communityColors.length] }}
          />
          <span className="text-gray-600 dark:text-gray-400 max-w-[80px] truncate">
            {community.title || `C${community.communityId}`}
          </span>
        </button>
      ))}
      {remainingCount > 0 && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}
