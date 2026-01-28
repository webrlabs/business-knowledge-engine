'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface BadgeToastProps {
  badge: {
    name: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
    icon: string;
  };
  onClose: () => void;
  show: boolean;
}

const RARITY_STYLES = {
  common: {
    accent: 'from-gray-400 to-gray-500',
    border: 'border-gray-300 dark:border-gray-600',
    bg: 'bg-gray-50 dark:bg-gray-800',
    text: 'text-gray-700 dark:text-gray-300',
    glow: '',
    label: 'text-gray-500 dark:text-gray-400',
  },
  rare: {
    accent: 'from-blue-400 to-blue-600',
    border: 'border-blue-300 dark:border-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    glow: 'shadow-blue-500/20',
    label: 'text-blue-500 dark:text-blue-400',
  },
  epic: {
    accent: 'from-purple-400 to-purple-600',
    border: 'border-purple-300 dark:border-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
    glow: 'shadow-purple-500/25',
    label: 'text-purple-500 dark:text-purple-400',
  },
  legendary: {
    accent: 'from-amber-400 to-amber-600',
    border: 'border-amber-300 dark:border-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    glow: 'shadow-amber-500/30',
    label: 'text-amber-500 dark:text-amber-400',
  },
} as const;

const AUTO_DISMISS_MS = 5000;

export default function BadgeToast({ badge, onClose, show }: BadgeToastProps) {
  const [state, setState] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const startExit = useCallback(() => {
    setState('exiting');
    exitTimerRef.current = setTimeout(() => {
      setState('hidden');
      onClose();
    }, 400);
  }, [onClose]);

  // Handle show/hide transitions
  useEffect(() => {
    if (show) {
      setState('entering');
      // Brief entering state, then visible
      const enterTimer = setTimeout(() => {
        setState('visible');
      }, 50);

      // Auto-dismiss timer
      timerRef.current = setTimeout(() => {
        startExit();
      }, AUTO_DISMISS_MS);

      return () => {
        clearTimeout(enterTimer);
        clearTimers();
      };
    } else {
      if (state === 'visible' || state === 'entering') {
        startExit();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleDismiss = () => {
    clearTimers();
    startExit();
  };

  if (state === 'hidden') return null;

  const style = RARITY_STYLES[badge.rarity];
  const isVisible = state === 'visible';
  const isExiting = state === 'exiting';

  return (
    <div
      className="fixed top-4 right-4 z-50 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`
          pointer-events-auto max-w-xs w-80
          rounded-xl border ${style.border} ${style.bg}
          shadow-lg ${style.glow}
          overflow-hidden
          transition-all duration-400 ease-out
          ${isVisible
            ? 'opacity-100 translate-x-0 translate-y-0 scale-100'
            : isExiting
              ? 'opacity-0 translate-x-8 scale-95'
              : 'opacity-0 -translate-y-3 translate-x-8 scale-95'
          }
        `}
        role="alert"
        style={{
          transitionDuration: isExiting ? '400ms' : '500ms',
          transitionTimingFunction: isExiting
            ? 'cubic-bezier(0.4, 0, 1, 1)'
            : 'cubic-bezier(0, 0, 0.2, 1)',
        }}
      >
        {/* Accent gradient bar */}
        <div className={`h-1 w-full bg-gradient-to-r ${style.accent}`} />

        <div className="flex items-center gap-3 px-4 py-3">
          {/* Badge icon */}
          <div
            className={`
              flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center
              bg-gradient-to-br ${style.accent} shadow-sm
            `}
          >
            <span className="text-xl" role="img" aria-hidden="true">
              {badge.icon}
            </span>
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <svg
                className="w-3.5 h-3.5 text-green-500 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
              </svg>
              <span className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wide">
                Badge Earned!
              </span>
            </div>
            <p className={`text-sm font-bold ${style.text} truncate mt-0.5`}>
              {badge.name}
            </p>
            <p className={`text-[10px] font-medium uppercase tracking-wider ${style.label} mt-0.5`}>
              {badge.rarity}
            </p>
          </div>

          {/* Close button */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
            aria-label="Dismiss badge notification"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Auto-dismiss progress bar */}
        {(isVisible || state === 'entering') && (
          <div className="h-0.5 w-full bg-gray-200/50 dark:bg-gray-700/50">
            <div
              className={`h-full bg-gradient-to-r ${style.accent} transition-none`}
              style={{
                width: '100%',
                animation: `badge-toast-shrink ${AUTO_DISMISS_MS}ms linear forwards`,
              }}
            />
          </div>
        )}

        <style jsx>{`
          @keyframes badge-toast-shrink {
            from { width: 100%; }
            to { width: 0%; }
          }
        `}</style>
      </div>
    </div>
  );
}
