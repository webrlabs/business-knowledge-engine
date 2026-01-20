'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { API_BASE_URL, useAuthFetch } from '@/lib/api';
import DashboardLayout from '@/components/DashboardLayout';
import { InlineLoader } from '@/components/LoadingSpinner';
import { useToast, ToastContainer } from '@/components/Toast';
import HelpTooltip from '@/components/HelpTooltip';

export default function UploadPage() {
  const router = useRouter();
  const toast = useToast();
  const { user, roles, isAuthenticated } = useAuth();
  const authFetch = useAuthFetch();
  const [accessDenied, setAccessDenied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Batch upload state
  const [uploadMode, setUploadMode] = useState<'single' | 'batch'>('single');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    total: number;
    completed: number;
    failed: number;
    processing: string[];
  }>({ total: 0, completed: 0, failed: 0, processing: [] });

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }

    // Check if user has required role for document upload
    // Admin, Reviewer, or Contributor can upload, but Viewer cannot
    const canUpload = roles.some((role) => ['Admin', 'Reviewer', 'Contributor'].includes(role));

    setAccessDenied(!canUpload);
  }, [isAuthenticated, roles, router]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      // Auto-populate title from filename if not already set
      if (!title) {
        setTitle(e.target.files[0].name);
      }
      toast.info('File Selected', `${e.target.files[0].name} is ready to upload`);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      // Check file type
      const file = files[0];
      const allowedTypes = ['.pdf', '.docx', '.pptx', '.xlsx', '.vsdx', '.doc', '.ppt', '.xls'];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();

      if (!allowedTypes.includes(ext)) {
        toast.error(
          'Invalid File Type',
          `Please upload one of these file types: ${allowedTypes.join(', ')}`,
          7000
        );
        return;
      }

      setSelectedFile(file);
      // Auto-populate title from filename if not already set
      if (!title) {
        setTitle(file.name);
      }
      toast.info('File Dropped', `${file.name} is ready to upload`);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);

    try {
      // Create FormData to send file and metadata
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', title || selectedFile.name);
      formData.append('description', description);
      formData.append('tags', tags);

      // Upload to backend
      const response = await authFetch(`${API_BASE_URL}/api/documents/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const result = await response.json();
      console.log('Upload successful:', result);

      setUploading(false);

      // Show success toast with action
      toast.success(
        'Upload Successful!',
        `${selectedFile.name} has been uploaded and queued for processing`,
        6000
      );

      // Reset form
      setSelectedFile(null);
      setTitle('');
      setDescription('');
      setTags('');
    } catch (error) {
      console.error('Upload error:', error);
      setUploading(false);

      // Show error toast with helpful message
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      toast.error(
        'Upload Failed',
        `${errorMessage}. Please check your file and try again.`,
        8000,
        {
          label: 'Retry',
          onClick: () => {
            // User can click the upload button again
          }
        }
      );
    }
  };

  const handleBatchFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const filesArray = Array.from(e.target.files);
      setSelectedFiles(filesArray);
      toast.info('Files Selected', `${filesArray.length} files ready for batch upload`);
    }
  };

  const handleBatchUpload = async () => {
    if (selectedFiles.length === 0) return;

    setBatchUploading(true);
    setBatchProgress({
      total: selectedFiles.length,
      completed: 0,
      failed: 0,
      processing: []
    });

    let completed = 0;
    let failed = 0;

    // Process files in parallel (simulated)
    for (const file of selectedFiles) {
      try {
        setBatchProgress(prev => ({
          ...prev,
          processing: [...prev.processing, file.name]
        }));

        // Create FormData for this file
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', file.name);
        formData.append('description', 'Batch upload');
        formData.append('tags', tags);

        // Simulate upload delay for demo
        await new Promise(resolve => setTimeout(resolve, 500));

        // Upload to backend
        const response = await authFetch(`${API_BASE_URL}/api/documents/upload`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error('Upload failed');
        }

        completed++;
        setBatchProgress(prev => ({
          ...prev,
          completed: prev.completed + 1,
          processing: prev.processing.filter(name => name !== file.name)
        }));
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        failed++;
        setBatchProgress(prev => ({
          ...prev,
          failed: prev.failed + 1,
          processing: prev.processing.filter(name => name !== file.name)
        }));
      }
    }

    setBatchUploading(false);

    // Show completion toast
    if (failed === 0) {
      toast.success(
        'Batch Upload Complete!',
        `All ${selectedFiles.length} documents uploaded successfully`,
        6000
      );
    } else {
      toast.warning(
        'Batch Upload Finished',
        `${completed} succeeded, ${failed} failed out of ${selectedFiles.length} total`,
        8000
      );
    }

    // Reset
    setSelectedFiles([]);
  };

  const removeBatchFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleBackToDashboard = () => {
    router.push('/dashboard');
  };

  if (!user) {
    return null; // DashboardLayout will handle loading state
  }

  if (accessDenied) {
    return (
      <DashboardLayout>
        {/* Access Denied Message */}
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-lg p-8 text-center">
            <svg
              className="w-16 h-16 text-red-600 dark:text-red-400 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h2 className="text-2xl font-bold text-red-900 dark:text-red-100 mb-2">Access Denied</h2>
            <p className="text-red-800 dark:text-red-200 mb-4">
              You do not have permission to access this page.
            </p>
            <p className="text-sm text-red-700 dark:text-red-300 mb-6">
              Document upload requires one of the following roles: <strong>Admin</strong>, <strong>Reviewer</strong>, or <strong>Contributor</strong>.
            </p>
            <p className="text-sm text-red-700 dark:text-red-300 mb-6">
              Your current roles: <strong>{user.roles.join(', ')}</strong>
            </p>
            <button
              onClick={handleBackToDashboard}
              className="btn-primary"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Upload Documents</h2>
            <HelpTooltip
              content="Upload business process documents (PDF, Word, PowerPoint, Excel, or Visio) to extract entities and relationships for your knowledge graph. Documents are analyzed using AI to identify processes, tasks, roles, and their connections."
              learnMoreLink="#"
            />
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Upload business process documents for analysis and knowledge graph extraction
          </p>
        </div>

        {/* Mode Toggle */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setUploadMode('single')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              uploadMode === 'single'
                ? 'bg-blue-600 text-white dark:bg-blue-500'
                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Single Upload
          </button>
          <button
            onClick={() => setUploadMode('batch')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              uploadMode === 'batch'
                ? 'bg-blue-600 text-white dark:bg-blue-500'
                : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Batch Upload
          </button>
        </div>

        {/* Upload Form */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          {uploadMode === 'single' ? (
            <form onSubmit={handleUpload} className="space-y-6">
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-all duration-200 ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-102'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg
                className={`w-12 h-12 mx-auto mb-4 transition-colors duration-200 ${
                  isDragging ? 'text-blue-500 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'
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
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileSelect}
                accept=".pdf,.docx,.pptx,.xlsx,.vsdx"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium text-lg"
              >
                Choose a file
              </label>
              <span className={`text-gray-600 dark:text-gray-400 text-lg ${isDragging ? 'font-semibold text-blue-700 dark:text-blue-300' : ''}`}> or drag and drop</span>
              <p className={`text-sm mt-2 ${isDragging ? 'text-blue-600 dark:text-blue-400 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                PDF, Word, PowerPoint, Excel, or Visio files
              </p>
              {selectedFile && (
                <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    Selected: <strong>{selectedFile.name}</strong>
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Size: {(selectedFile.size / 1024).toFixed(2)} KB
                  </p>
                </div>
              )}
            </div>

            {selectedFile && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Document Title
                  </label>
                  <input
                    type="text"
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    placeholder="Enter document title"
                  />
                </div>

                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description (optional)
                  </label>
                  <textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    placeholder="Enter document description"
                  />
                </div>

                <div>
                  <label htmlFor="tags" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Tags (optional, comma-separated)
                  </label>
                  <input
                    type="text"
                    id="tags"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                    placeholder="e.g., process, documentation, workflow"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={!selectedFile || uploading}
              className="btn-primary w-full"
            >
              {uploading ? <InlineLoader text="Uploading document..." /> : 'Upload Document'}
            </button>
          </form>
          ) : (
            <div className="space-y-6">
              {/* Batch File Selection */}
              <div>
                <input
                  type="file"
                  id="batch-file-upload"
                  className="hidden"
                  onChange={handleBatchFileSelect}
                  accept=".pdf,.docx,.pptx,.xlsx,.vsdx"
                  multiple
                />
                <label
                  htmlFor="batch-file-upload"
                  className="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  Select Multiple Files
                </label>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  You can select 10 or more documents to upload at once
                </p>
              </div>

              {/* Selected Files List */}
              {selectedFiles.length > 0 && (
                <div className="space-y-2">
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    Selected Files ({selectedFiles.length})
                  </h3>
                  <div className="max-h-60 overflow-y-auto space-y-2">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {file.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {(file.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                        <button
                          onClick={() => removeBatchFile(index)}
                          className="ml-2 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          disabled={batchUploading}
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch Progress */}
              {batchUploading && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
                    Upload Progress
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-blue-700 dark:text-blue-300">
                      <span>Completed: {batchProgress.completed}</span>
                      <span>Failed: {batchProgress.failed}</span>
                      <span>Total: {batchProgress.total}</span>
                    </div>
                    <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${((batchProgress.completed + batchProgress.failed) / batchProgress.total) * 100}%`
                        }}
                      />
                    </div>
                    {batchProgress.processing.length > 0 && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">
                        Processing: {batchProgress.processing.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Batch Upload Button */}
              <button
                onClick={handleBatchUpload}
                disabled={selectedFiles.length === 0 || batchUploading}
                className="btn-primary w-full"
              >
                {batchUploading ? (
                  <InlineLoader text={`Uploading ${batchProgress.completed + batchProgress.failed + 1} of ${batchProgress.total}...`} />
                ) : (
                  `Upload ${selectedFiles.length} Document${selectedFiles.length !== 1 ? 's' : ''}`
                )}
              </button>
            </div>
          )}
        </div>

        {/* User Permissions Info */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start">
            <svg
              className="w-5 h-5 text-blue-600 dark:text-blue-400 mr-3 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Your Access Level
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                You have permission to upload documents with the following roles: {user.roles.join(', ')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
