/**
 * LoadingSpinner Component
 *
 * A reusable loading indicator for long-running operations
 * Provides consistent loading feedback across the application
 */

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  color?: 'blue' | 'white' | 'gray';
  text?: string;
  className?: string;
}

export default function LoadingSpinner({
  size = 'md',
  color = 'blue',
  text,
  className = '',
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  const colorClasses = {
    blue: 'border-blue-600',
    white: 'border-white',
    gray: 'border-gray-600',
  };

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div
        className={`${sizeClasses[size]} ${colorClasses[color]} border-4 border-t-transparent rounded-full animate-spin`}
        role="status"
        aria-label={text || 'Loading'}
      />
      {text && (
        <p className="mt-2 text-sm text-gray-600 font-medium animate-pulse">
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * LoadingOverlay Component
 *
 * Full-screen overlay with loading spinner for blocking operations
 */

interface LoadingOverlayProps {
  text?: string;
  transparent?: boolean;
}

export function LoadingOverlay({ text = 'Loading...', transparent = false }: LoadingOverlayProps) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        transparent ? 'bg-white/70' : 'bg-gray-900/50'
      }`}
    >
      <div className="bg-white rounded-lg shadow-xl p-8">
        <LoadingSpinner size="lg" text={text} />
      </div>
    </div>
  );
}

/**
 * InlineLoader Component
 *
 * Inline loading indicator for buttons and form elements
 */

interface InlineLoaderProps {
  text: string;
  className?: string;
}

export function InlineLoader({ text, className = '' }: InlineLoaderProps) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <svg
        className="animate-spin -ml-1 mr-3 h-5 w-5"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      {text}
    </span>
  );
}
