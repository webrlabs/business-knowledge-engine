'use client';

interface FilePreviewProps {
  file: File;
  onRemove: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string): string {
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf') return 'pdf';
  if (type.includes('word') || type.includes('document')) return 'doc';
  if (type.includes('sheet') || type.includes('excel')) return 'sheet';
  if (type.includes('presentation') || type.includes('powerpoint')) return 'slides';
  return 'file';
}

const iconColors: Record<string, string> = {
  image: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  pdf: 'text-red-500 bg-red-50 dark:bg-red-900/20',
  doc: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  sheet: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20',
  slides: 'text-orange-500 bg-orange-50 dark:bg-orange-900/20',
  file: 'text-gray-500 bg-gray-50 dark:bg-gray-800',
};

export default function FilePreview({ file, onRemove }: FilePreviewProps) {
  const fileType = getFileIcon(file.type);
  const isImage = file.type.startsWith('image/');

  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 max-w-xs">
      {isImage ? (
        <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-gray-100 dark:bg-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={URL.createObjectURL(file)}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <div className={`w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${iconColors[fileType]}`}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-900 dark:text-white truncate">
          {file.name}
        </p>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          {formatFileSize(file.size)}
        </p>
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
        aria-label="Remove file"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
