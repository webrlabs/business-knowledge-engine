'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';

interface DocumentUploadProps {
  onUploadSuccess: () => void;
  compact?: boolean;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  processing: string[];
}

export default function DocumentUpload({ onUploadSuccess, compact = false }: DocumentUploadProps) {
  const authFetch = useAuthFetch();
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;

      setUploading(true);

      try {
        if (uploadMode === 'single' || acceptedFiles.length === 1) {
          // Single file upload
          const formData = new FormData();
          formData.append('file', acceptedFiles[0]);
          formData.append('title', acceptedFiles[0].name);

          const response = await authFetch(`${API_BASE_URL}/api/documents/upload`, {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Upload failed');
          }

          onUploadSuccess();
        } else {
          // Batch upload
          setBatchProgress({
            total: acceptedFiles.length,
            completed: 0,
            failed: 0,
            processing: [],
          });

          for (const file of acceptedFiles) {
            try {
              setBatchProgress((prev) =>
                prev
                  ? { ...prev, processing: [...prev.processing, file.name] }
                  : null
              );

              const formData = new FormData();
              formData.append('file', file);
              formData.append('title', file.name);

              const response = await authFetch(`${API_BASE_URL}/api/documents/upload`, {
                method: 'POST',
                body: formData,
              });

              if (!response.ok) {
                throw new Error('Upload failed');
              }

              setBatchProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      completed: prev.completed + 1,
                      processing: prev.processing.filter((name) => name !== file.name),
                    }
                  : null
              );
            } catch {
              setBatchProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      failed: prev.failed + 1,
                      processing: prev.processing.filter((name) => name !== file.name),
                    }
                  : null
              );
            }
          }

          onUploadSuccess();
        }
      } catch (error) {
        console.error('Upload error:', error);
      } finally {
        setUploading(false);
        setBatchProgress(null);
      }
    },
    [uploadMode, authFetch, onUploadSuccess]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.visio': ['.vsd', '.vsdx'],
    },
    multiple: uploadMode === 'batch',
    disabled: uploading,
  });

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setUploadMode('single')}
          className={`flex-1 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            uploadMode === 'single'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Single Upload
        </button>
        <button
          type="button"
          onClick={() => setUploadMode('batch')}
          className={`flex-1 px-3 py-1.5 text-sm font-medium rounded transition-colors ${
            uploadMode === 'batch'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          Batch Upload
        </button>
      </div>

      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg text-center cursor-pointer
          transition-colors
          ${compact ? 'p-4' : 'p-6'}
          ${isDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'}
          ${uploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />

        {uploading && batchProgress ? (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-blue-700 dark:text-blue-300">
              <span>Completed: {batchProgress.completed}</span>
              <span>Failed: {batchProgress.failed}</span>
              <span>Total: {batchProgress.total}</span>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${((batchProgress.completed + batchProgress.failed) / batchProgress.total) * 100}%`,
                }}
              />
            </div>
            {batchProgress.processing.length > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400 truncate">
                Processing: {batchProgress.processing[0]}
              </p>
            )}
          </div>
        ) : uploading ? (
          <div className="space-y-2">
            <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-600 dark:text-gray-400">Uploading...</p>
          </div>
        ) : (
          <>
            <svg
              className={`w-8 h-8 mx-auto mb-2 ${
                isDragActive ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
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
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
              {isDragActive ? 'Drop files here' : 'Choose a file'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">or drag and drop</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              PDF, Word, PowerPoint, Excel, or Visio
            </p>
            {uploadMode === 'batch' && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                Multiple files allowed
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
