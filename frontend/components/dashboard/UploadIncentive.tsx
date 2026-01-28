'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const DISMISS_KEY = 'uploadIncentiveDismissed';

interface UploadIncentiveProps {
  weeklyUploads: number;
  weeklyTarget?: number;
}

export default function UploadIncentive({
  weeklyUploads,
  weeklyTarget = 5,
}: UploadIncentiveProps) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored === 'true') {
      setDismissed(true);
    } else {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }, []);

  const handleNavigate = () => {
    router.push('/dashboard/upload');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      router.push('/dashboard/upload');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    // Navigate to upload page where the actual upload logic lives
    router.push('/dashboard/upload');
  };

  if (dismissed) {
    return null;
  }

  const progress = Math.min((weeklyUploads / weeklyTarget) * 100, 100);
  const isComplete = weeklyUploads >= weeklyTarget;

  return (
    <div
      onClick={handleNavigate}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="link"
      tabIndex={0}
      aria-label="Upload documents to earn points"
      className={`
        relative overflow-hidden rounded-xl cursor-pointer
        border-2 border-dashed transition-all duration-300 ease-out
        ${isDragOver
          ? 'border-blue-400 bg-blue-50/80 dark:border-blue-500 dark:bg-blue-950/40 scale-[1.01]'
          : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'
        }
        hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-500
        hover:bg-gradient-to-br hover:from-white hover:to-blue-50/50
        dark:hover:from-gray-800 dark:hover:to-blue-950/30
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500
      `}
    >
      {/* Gradient accent bar at top */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss upload incentive"
        className="
          absolute top-3 right-3 z-10 p-1 rounded-full
          text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300
          hover:bg-gray-100 dark:hover:bg-gray-700
          transition-colors duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        "
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="p-5 pt-6">
        {/* Icon and CTA */}
        <div className="flex items-start gap-4">
          {/* Upload icon area */}
          <div className={`
            flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl
            ${isDragOver
              ? 'bg-blue-100 dark:bg-blue-900/50'
              : 'bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/40 dark:to-indigo-900/40'
            }
            transition-colors duration-200
          `}>
            <svg
              className={`w-6 h-6 transition-colors duration-200 ${
                isDragOver
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-blue-500 dark:text-blue-400'
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {isDragOver ? 'Drop files here' : 'Upload Documents'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {isDragOver
                ? 'Release to navigate to upload'
                : 'Drag & drop files or click to upload'
              }
            </p>

            {/* Incentive badge */}
            <div className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
              <svg className="w-3.5 h-3.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                +10 pts per upload
              </span>
            </div>
          </div>
        </div>

        {/* Weekly progress section */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Weekly progress
            </span>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {weeklyUploads}/{weeklyTarget}
              {isComplete && (
                <span className="ml-1 text-green-600 dark:text-green-400">
                  &#10003;
                </span>
              )}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`
                h-full rounded-full transition-all duration-700 ease-out
                ${isComplete
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500'
                  : 'bg-gradient-to-r from-blue-400 to-indigo-500'
                }
              `}
              style={{ width: `${progress}%` }}
              role="progressbar"
              aria-valuenow={weeklyUploads}
              aria-valuemin={0}
              aria-valuemax={weeklyTarget}
              aria-label={`${weeklyUploads} of ${weeklyTarget} uploads this week`}
            />
          </div>

          {/* Motivational message */}
          {!isComplete && weeklyUploads > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
              {weeklyTarget - weeklyUploads} more to reach your weekly goal!
            </p>
          )}
          {isComplete && (
            <p className="text-xs text-green-600 dark:text-green-400 font-medium mt-1.5">
              Weekly goal reached! Keep the momentum going.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
