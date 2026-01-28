'use client';

import { useMemo } from 'react';

interface StreakDisplayProps {
  streakDays: number;
  lastActiveDate: string | null;
}

function FlameIcon({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'w-8 h-8' : size === 'md' ? 'w-6 h-6' : 'w-5 h-5';

  return (
    <svg
      className={`${dims} text-orange-500`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 23c-4.97 0-8-3.03-8-7 0-2.72 1.37-5.32 2.8-7.24.44-.59 1.3-.28 1.3.46 0 1.05.62 2.04 1.3 2.78.16.18.44.06.44-.18 0-2.15.96-4.42 2.48-6.07.42-.46 1.16-.16 1.16.46 0 2.56 1.28 4.72 3.12 5.96.33.22.68-.12.55-.48-.32-.88-.48-1.84-.48-2.85 0-.37.4-.58.68-.34C19.78 10.63 20 13.03 20 16c0 3.97-3.03 7-8 7zm0-2c3.31 0 5.5-1.97 5.5-5 0-1.16-.13-2.22-.5-3.16-.48 1.04-1.3 1.9-2.3 2.44-.47.25-.98-.18-.88-.7.13-.7.18-1.45.18-2.22 0-.7-.1-1.37-.28-2-.82 1.34-2.02 2.42-3.22 3.14-.47.28-1-.17-.88-.7.15-.6.22-1.22.22-1.86 0-.18-.01-.36-.03-.54C8.77 10.2 7.5 12.46 7.5 16c0 3.03 2.19 5 4.5 5z" />
    </svg>
  );
}

function getFlameSize(streakDays: number): 'sm' | 'md' | 'lg' {
  if (streakDays >= 14) return 'lg';
  if (streakDays >= 7) return 'md';
  return 'sm';
}

function getStreakColor(streakDays: number): string {
  if (streakDays >= 14) return 'text-orange-500';
  if (streakDays >= 7) return 'text-amber-500';
  return 'text-yellow-500';
}

export default function StreakDisplay({
  streakDays,
  lastActiveDate,
}: StreakDisplayProps) {
  // Build a 7-day calendar with activity dots
  const recentDays = useMemo(() => {
    const days: { label: string; active: boolean }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastActive = lastActiveDate ? new Date(lastActiveDate) : null;
    if (lastActive) lastActive.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'narrow' });

      // A day is "active" if it falls within the streak range ending at lastActiveDate
      let active = false;
      if (lastActive && streakDays > 0) {
        const streakStart = new Date(lastActive);
        streakStart.setDate(streakStart.getDate() - (streakDays - 1));
        streakStart.setHours(0, 0, 0, 0);
        active = date >= streakStart && date <= lastActive;
      }

      days.push({ label: dayLabel, active });
    }

    return days;
  }, [streakDays, lastActiveDate]);

  const flameSize = getFlameSize(streakDays);
  const streakColor = getStreakColor(streakDays);
  const isWeeklyBonus = streakDays > 0 && streakDays % 7 === 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Streak header */}
      <div className="flex items-center gap-2.5">
        <div
          className={`
            flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-xl
            bg-gradient-to-br from-orange-100 to-amber-100
            dark:from-orange-900/30 dark:to-amber-900/30
            ${streakDays >= 7 ? 'animate-pulse' : ''}
          `}
        >
          <FlameIcon size={flameSize} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-bold tabular-nums ${streakColor}`}>
              {streakDays}
            </span>
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
              day{streakDays !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Current streak
          </p>
        </div>

        {/* Streak bonus indicator */}
        <div className="flex-shrink-0">
          {isWeeklyBonus ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800">
              <svg className="w-3 h-3 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-xs font-semibold text-orange-700 dark:text-orange-400">
                +25 weekly
              </span>
            </span>
          ) : streakDays > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                +5 daily
              </span>
            </span>
          ) : null}
        </div>
      </div>

      {/* 7-day activity calendar */}
      <div className="flex items-center gap-1.5">
        {recentDays.map((day, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 leading-none">
              {day.label}
            </span>
            <div
              className={`
                w-full aspect-square max-w-[24px] rounded-md transition-colors
                ${
                  day.active
                    ? 'bg-gradient-to-br from-orange-400 to-amber-500 shadow-sm shadow-orange-500/20'
                    : 'bg-gray-100 dark:bg-gray-700/50'
                }
              `}
              title={day.active ? 'Active' : 'Inactive'}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
