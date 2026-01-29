'use client';

import { Community } from '@/components/CommunityVisualization';

interface CommunityStatsBarProps {
  communities: Community[];
  modularity?: number;
}

export default function CommunityStatsBar({ communities, modularity }: CommunityStatsBarProps) {
  const totalMembers = communities.reduce((acc, c) => acc + c.memberCount, 0);
  const avgSize = communities.length > 0
    ? Math.round(totalMembers / communities.length)
    : 0;

  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400">Communities:</span>
        <span className="font-semibold text-gray-900 dark:text-white">{communities.length}</span>
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
      <div className="flex items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400">Members:</span>
        <span className="font-semibold text-gray-900 dark:text-white">{totalMembers}</span>
      </div>
      <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
      <div className="flex items-center gap-2">
        <span className="text-gray-500 dark:text-gray-400">Avg Size:</span>
        <span className="font-semibold text-gray-900 dark:text-white">{avgSize}</span>
      </div>
      {modularity !== undefined && (
        <>
          <div className="h-4 w-px bg-gray-300 dark:bg-gray-600" />
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-gray-400">Modularity:</span>
            <span className="font-semibold text-gray-900 dark:text-white">{modularity.toFixed(3)}</span>
          </div>
        </>
      )}
    </div>
  );
}
