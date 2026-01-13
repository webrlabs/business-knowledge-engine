'use client';

import React from 'react';

interface ProgressBarProps {
  /** Progress percentage (0-100) */
  progress: number;
  /** Optional label to display */
  label?: string;
  /** Whether to show percentage text */
  showPercentage?: boolean;
  /** Color variant */
  variant?: 'primary' | 'success' | 'warning' | 'error';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether the progress is indeterminate (animated loading) */
  indeterminate?: boolean;
  /** Optional className for custom styling */
  className?: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  label,
  showPercentage = true,
  variant = 'primary',
  size = 'md',
  indeterminate = false,
  className = '',
}) => {
  // Clamp progress between 0 and 100
  const clampedProgress = Math.min(Math.max(progress, 0), 100);

  // Variant color classes
  const variantClasses = {
    primary: 'bg-blue-600',
    success: 'bg-green-600',
    warning: 'bg-yellow-600',
    error: 'bg-red-600',
  };

  // Size classes
  const sizeClasses = {
    sm: 'h-2',
    md: 'h-4',
    lg: 'h-6',
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Label and percentage */}
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-2">
          {label && <span className="text-sm font-medium text-gray-700">{label}</span>}
          {showPercentage && !indeterminate && (
            <span className="text-sm font-medium text-gray-700">{clampedProgress}%</span>
          )}
        </div>
      )}

      {/* Progress bar container */}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${sizeClasses[size]}`}>
        {indeterminate ? (
          /* Indeterminate animated progress */
          <div className="h-full animate-progress-indeterminate">
            <div className={`h-full w-1/3 ${variantClasses[variant]}`}></div>
          </div>
        ) : (
          /* Determinate progress */
          <div
            className={`h-full ${variantClasses[variant]} transition-all duration-500 ease-out`}
            style={{ width: `${clampedProgress}%` }}
            role="progressbar"
            aria-valuenow={clampedProgress}
            aria-valuemin={0}
            aria-valuemax={100}
          ></div>
        )}
      </div>
    </div>
  );
};

export default ProgressBar;
