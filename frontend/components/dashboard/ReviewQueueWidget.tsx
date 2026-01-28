'use client';

import Link from 'next/link';

interface PendingReview {
  id: string;
  title: string;
  confidence: number;
  uploadedAt: string;
}

interface ReviewQueueWidgetProps {
  pendingReviews: PendingReview[];
}

function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-500';
  if (confidence >= 0.5) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return 'High';
  if (confidence >= 0.5) return 'Medium';
  return 'Low';
}

export default function ReviewQueueWidget({ pendingReviews }: ReviewQueueWidgetProps) {
  if (pendingReviews.length === 0) {
    return null;
  }

  const topReviews = pendingReviews.slice(0, 3);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Pending Reviews
        </h3>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
          {pendingReviews.length}
        </span>
      </div>

      {/* Review Cards */}
      <div className="space-y-3">
        {topReviews.map((review) => (
          <Link
            key={review.id}
            href={`/dashboard/review/${review.id}`}
            className="block group"
          >
            <div className="p-3 bg-gray-50 dark:bg-gray-750 dark:bg-gray-900/50 rounded-xl border border-gray-100 dark:border-gray-700/50 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-all duration-200 cursor-pointer">
              {/* Title and Points Badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate flex-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  {review.title}
                </p>
                <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                  +15 pts
                </span>
              </div>

              {/* Confidence Bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getConfidenceColor(review.confidence)}`}
                    style={{ width: `${Math.round(review.confidence * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {getConfidenceLabel(review.confidence)}
                </span>
              </div>

              {/* Timestamp */}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                Uploaded {formatRelativeTime(review.uploadedAt)}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* View All Link */}
      <Link
        href="/dashboard/review"
        className="mt-4 flex items-center justify-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors py-2"
      >
        View all reviews
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  );
}
