'use client';

import { LevelInfo } from '@/lib/gamification-types';

interface LevelProgressProps {
  level: LevelInfo;
}

function LevelIcon({ index }: { index: number }) {
  // Shield icon that gets more elaborate at higher levels
  const color =
    index >= 8
      ? 'from-yellow-400 to-amber-500'
      : index >= 5
        ? 'from-purple-400 to-indigo-500'
        : index >= 3
          ? 'from-blue-400 to-cyan-500'
          : 'from-gray-300 to-gray-400 dark:from-gray-500 dark:to-gray-600';

  return (
    <div
      className={`
        flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-lg
        bg-gradient-to-br ${color} shadow-sm
      `}
    >
      <svg
        className="w-5 h-5 text-white"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <span className="absolute text-[9px] font-bold text-white/90 mt-0.5">
        {index + 1}
      </span>
    </div>
  );
}

export default function LevelProgress({ level }: LevelProgressProps) {
  const { name, index, xp, xpForNext, nextLevelName, progress } = level;
  const xpRemaining = Math.max(xpForNext - xp, 0);
  const progressPercent = Math.min(Math.max(progress * 100, 0), 100);
  const isMaxLevel = nextLevelName === null;

  return (
    <div className="flex items-start gap-3">
      {/* Level badge */}
      <div className="relative">
        <LevelIcon index={index} />
      </div>

      {/* Progress content */}
      <div className="flex-1 min-w-0">
        {/* Level name and XP count */}
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {name}
          </span>
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums ml-2 flex-shrink-0">
            {xp.toLocaleString()} XP
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-700 ease-out"
            style={{ width: `${progressPercent}%` }}
            role="progressbar"
            aria-valuenow={xp}
            aria-valuemin={0}
            aria-valuemax={xpForNext}
            aria-label={`${xp} of ${xpForNext} XP towards ${nextLevelName ?? 'max level'}`}
          />
        </div>

        {/* XP to next level */}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {isMaxLevel ? (
            <span className="text-purple-600 dark:text-purple-400 font-medium">
              Max level reached
            </span>
          ) : (
            <>
              <span className="font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
                {xpRemaining.toLocaleString()}
              </span>{' '}
              XP to{' '}
              <span className="font-medium text-purple-600 dark:text-purple-400">
                {nextLevelName}
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
