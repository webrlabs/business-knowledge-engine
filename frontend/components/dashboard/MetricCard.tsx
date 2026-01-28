'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Tooltip from '@/components/Tooltip';

interface MetricCardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  trend?: number;
  icon: ReactNode;
  href: string;
  colorClass: string;
  tooltip: string;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  trend,
  icon,
  href,
  colorClass,
  tooltip,
}: MetricCardProps) {
  const router = useRouter();
  const [displayValue, setDisplayValue] = useState<string | number>(
    typeof value === 'number' ? 0 : value
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  // Animated count-up effect for numeric values
  useEffect(() => {
    if (typeof value !== 'number' || hasAnimated.current) {
      setDisplayValue(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          animateValue(0, value, 800);
        }
      },
      { threshold: 0.3 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [value]);

  function animateValue(start: number, end: number, duration: number) {
    const startTime = performance.now();
    const isInteger = Number.isInteger(end);

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;

      setDisplayValue(isInteger ? Math.round(current) : parseFloat(current.toFixed(1)));

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  const handleClick = () => {
    router.push(href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.push(href);
    }
  };

  return (
    <Tooltip content={tooltip} position="top">
      <div
        ref={cardRef}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="link"
        tabIndex={0}
        aria-label={`${title}: ${value}${subtitle ? ` - ${subtitle}` : ''}`}
        className={`
          relative overflow-hidden rounded-xl p-5 cursor-pointer
          bg-gradient-to-br ${colorClass}
          shadow-sm hover:shadow-lg
          transform transition-all duration-300 ease-out
          hover:scale-[1.03] active:scale-[0.98]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500
          dark:shadow-gray-900/30
        `}
      >
        {/* Background decorative element */}
        <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-white/10 dark:bg-white/5 pointer-events-none" />

        {/* Header row: icon + trend */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/20 dark:bg-white/10 text-white">
            {icon}
          </div>
          {trend !== undefined && trend !== 0 && (
            <div
              className={`
                flex items-center gap-0.5 text-xs font-semibold px-2 py-1 rounded-full
                ${trend > 0
                  ? 'bg-green-100/80 text-green-700 dark:bg-green-900/40 dark:text-green-400'
                  : 'bg-red-100/80 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                }
              `}
            >
              {trend > 0 ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              )}
              <span>{Math.abs(trend)}%</span>
            </div>
          )}
        </div>

        {/* Value */}
        <div className="text-3xl font-bold text-white tracking-tight mb-1">
          {displayValue}
        </div>

        {/* Title */}
        <div className="text-sm font-medium text-white/80">
          {title}
        </div>

        {/* Subtitle */}
        {subtitle && (
          <div className="text-xs text-white/60 mt-1">
            {subtitle}
          </div>
        )}
      </div>
    </Tooltip>
  );
}
