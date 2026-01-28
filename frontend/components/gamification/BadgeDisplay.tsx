'use client';

import { useState, useRef, useEffect } from 'react';
import type { Achievement } from '@/lib/gamification-types';

interface BadgeDisplayProps {
  badge: Achievement;
  size?: 'sm' | 'md';
}

const RARITY_CONFIG = {
  common: {
    border: 'border-gray-300 dark:border-gray-600',
    bg: 'bg-gray-100 dark:bg-gray-700',
    text: 'text-gray-700 dark:text-gray-300',
    label: 'text-gray-500 dark:text-gray-400',
    ring: 'stroke-gray-400 dark:stroke-gray-500',
    glow: '',
    pillBg: 'bg-gray-200 dark:bg-gray-600',
    pillText: 'text-gray-600 dark:text-gray-300',
  },
  rare: {
    border: 'border-blue-300 dark:border-blue-600',
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    label: 'text-blue-500 dark:text-blue-400',
    ring: 'stroke-blue-500 dark:stroke-blue-400',
    glow: '',
    pillBg: 'bg-blue-100 dark:bg-blue-900/50',
    pillText: 'text-blue-700 dark:text-blue-300',
  },
  epic: {
    border: 'border-purple-300 dark:border-purple-600',
    bg: 'bg-purple-50 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
    label: 'text-purple-500 dark:text-purple-400',
    ring: 'stroke-purple-500 dark:stroke-purple-400',
    glow: 'shadow-purple-500/20 dark:shadow-purple-400/10',
    pillBg: 'bg-purple-100 dark:bg-purple-900/50',
    pillText: 'text-purple-700 dark:text-purple-300',
  },
  legendary: {
    border: 'border-amber-300 dark:border-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    label: 'text-amber-500 dark:text-amber-400',
    ring: 'stroke-amber-500 dark:stroke-amber-400',
    glow: 'shadow-amber-500/30 dark:shadow-amber-400/15',
    pillBg: 'bg-amber-100 dark:bg-amber-900/50',
    pillText: 'text-amber-700 dark:text-amber-300',
  },
} as const;

export default function BadgeDisplay({ badge, size = 'md' }: BadgeDisplayProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rarity = RARITY_CONFIG[badge.rarity];
  const isSm = size === 'sm';
  const progressPercent = Math.round((badge.progress ?? 0) * 100);

  const iconSize = isSm ? 'w-8 h-8' : 'w-12 h-12';
  const iconTextSize = isSm ? 'text-lg' : 'text-2xl';
  const cardPadding = isSm ? 'p-2' : 'p-3';
  const nameSize = isSm ? 'text-[10px]' : 'text-xs';
  const cardWidth = isSm ? 'w-20' : 'w-28';

  // SVG progress ring dimensions
  const ringSize = isSm ? 36 : 52;
  const ringStroke = isSm ? 2.5 : 3;
  const ringRadius = (ringSize - ringStroke * 2) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference - (badge.progress ?? 0) * ringCircumference;

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 400);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowTooltip(false);
  };

  useEffect(() => {
    if (showTooltip && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      let top = triggerRect.top - tooltipRect.height - 10;
      let left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;

      const padding = 8;
      if (left < padding) left = padding;
      if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - tooltipRect.width - padding;
      }
      if (top < padding) {
        top = triggerRect.bottom + 10;
      }

      setTooltipPos({ top, left });
    }
  }, [showTooltip]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const hasGlow = badge.earned && (badge.rarity === 'epic' || badge.rarity === 'legendary');

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleMouseEnter}
        onBlur={handleMouseLeave}
        tabIndex={0}
        role="img"
        aria-label={`${badge.name} badge - ${badge.earned ? 'Earned' : `${progressPercent}% progress`} - ${badge.rarity} rarity`}
        className={`
          ${cardWidth} flex flex-col items-center gap-1.5 ${cardPadding} rounded-xl border
          cursor-default select-none transition-all duration-300
          ${badge.earned
            ? `${rarity.border} ${rarity.bg} ${hasGlow ? `shadow-lg ${rarity.glow}` : 'shadow-sm'}`
            : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-60'
          }
          hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2
          ${hasGlow ? 'animate-badge-glow' : ''}
        `}
      >
        {/* Badge Icon with Progress Ring */}
        <div className="relative flex items-center justify-center">
          {/* Progress ring for unearned badges */}
          {!badge.earned && (
            <svg
              width={ringSize}
              height={ringSize}
              className="absolute"
              style={{ transform: 'rotate(-90deg)' }}
            >
              {/* Background track */}
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={ringRadius}
                fill="none"
                strokeWidth={ringStroke}
                className="stroke-gray-200 dark:stroke-gray-700"
              />
              {/* Progress arc */}
              <circle
                cx={ringSize / 2}
                cy={ringSize / 2}
                r={ringRadius}
                fill="none"
                strokeWidth={ringStroke}
                strokeLinecap="round"
                className={rarity.ring}
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
              />
            </svg>
          )}

          {/* Icon */}
          <div
            className={`
              ${iconSize} flex items-center justify-center rounded-full
              ${badge.earned
                ? `${rarity.bg}`
                : 'grayscale'
              }
            `}
          >
            <span className={iconTextSize} role="img" aria-hidden="true">
              {badge.icon}
            </span>
          </div>

          {/* Earned check mark */}
          {badge.earned && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
              <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Badge Name */}
        <p
          className={`
            ${nameSize} font-medium text-center leading-tight truncate w-full
            ${badge.earned ? rarity.text : 'text-gray-400 dark:text-gray-500'}
          `}
          title={badge.name}
        >
          {badge.name}
        </p>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          ref={tooltipRef}
          role="tooltip"
          className="fixed z-50 pointer-events-none transition-opacity duration-200"
          style={{
            top: `${tooltipPos.top}px`,
            left: `${tooltipPos.left}px`,
          }}
        >
          <div className="bg-gray-900 dark:bg-gray-950 text-white rounded-xl shadow-xl px-4 py-3 max-w-[220px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-base" role="img" aria-hidden="true">{badge.icon}</span>
              <span className="text-sm font-semibold leading-tight">{badge.name}</span>
            </div>

            {/* Description */}
            <p className="text-xs text-gray-300 leading-relaxed mb-2">
              {badge.description}
            </p>

            {/* Rarity pill */}
            <div className="flex items-center justify-between">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${rarity.pillBg} ${rarity.pillText}`}
              >
                {badge.rarity}
              </span>

              {badge.earned ? (
                <span className="text-[10px] text-green-400 font-medium">
                  Earned {badge.earnedAt
                    ? new Date(badge.earnedAt).toLocaleDateString()
                    : ''}
                </span>
              ) : (
                <span className="text-[10px] text-gray-400 font-medium tabular-nums">
                  {progressPercent}%
                </span>
              )}
            </div>

            {/* Progress bar (unearned only) */}
            {!badge.earned && (
              <div className="mt-2 w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    badge.rarity === 'common' ? 'bg-gray-400' :
                    badge.rarity === 'rare' ? 'bg-blue-500' :
                    badge.rarity === 'epic' ? 'bg-purple-500' :
                    'bg-amber-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            {/* Arrow */}
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-gray-900 dark:bg-gray-950 rotate-45" />
          </div>
        </div>
      )}

      {/* Glow animation keyframes */}
      <style jsx>{`
        @keyframes badge-glow {
          0%, 100% { box-shadow: 0 0 8px 0px currentColor; }
          50% { box-shadow: 0 0 16px 2px currentColor; }
        }
        .animate-badge-glow {
          animation: badge-glow 3s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
