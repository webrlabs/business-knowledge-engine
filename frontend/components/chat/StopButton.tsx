'use client';

interface StopButtonProps {
  onClick: () => void;
}

export default function StopButton({ onClick }: StopButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700"
      aria-label="Stop generating"
      title="Stop generating"
    >
      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
    </button>
  );
}
