'use client';

import { Community } from '@/components/CommunityVisualization';
import { useCommunityStore } from '@/lib/community-store';
import CommunityListDropdown from './CommunityListDropdown';

interface CommunityControlsBarProps {
  communities: Community[];
  onFocusCommunity?: (communityId: string | number) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetView?: () => void;
}

export default function CommunityControlsBar({
  communities,
  onFocusCommunity,
  onZoomIn,
  onZoomOut,
  onResetView,
}: CommunityControlsBarProps) {
  const {
    currentLayout,
    colorMode,
    showLabels,
    setCurrentLayout,
    setColorMode,
    setShowLabels,
  } = useCommunityStore();

  return (
    <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between gap-4">
      {/* Left section: Community dropdown */}
      <div className="flex items-center gap-2">
        <CommunityListDropdown
          communities={communities}
          onFocusCommunity={onFocusCommunity}
        />

        {/* Labels toggle */}
        <label className="flex items-center gap-1.5 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => setShowLabels(e.target.checked)}
            className="w-3.5 h-3.5 text-blue-600 rounded"
          />
          <span className="text-xs text-gray-700 dark:text-gray-300">Labels</span>
        </label>
      </div>

      {/* Right section: Layout, Color, Zoom controls */}
      <div className="flex items-center gap-2">
        {/* Layout selector */}
        <select
          value={currentLayout}
          onChange={(e) => setCurrentLayout(e.target.value as 'cose' | 'circle' | 'concentric')}
          className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="cose">Force-Directed</option>
          <option value="circle">Circular</option>
          <option value="concentric">Concentric</option>
        </select>

        {/* Color mode toggle */}
        <div className="flex bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <button
            onClick={() => setColorMode('community')}
            className={`px-2 py-1.5 text-xs transition-colors ${
              colorMode === 'community'
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Community
          </button>
          <button
            onClick={() => setColorMode('entityType')}
            className={`px-2 py-1.5 text-xs transition-colors ${
              colorMode === 'entityType'
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Type
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
          <button
            onClick={onZoomIn}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Zoom In"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={onZoomOut}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Zoom Out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={onResetView}
            className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            title="Reset View"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
