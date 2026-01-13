'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import DashboardLayout from '@/components/DashboardLayout';
import ProgressBar from '@/components/ProgressBar';

export default function ProgressDemoPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuth();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [simulationRunning, setSimulationRunning] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/');
      return;
    }
  }, [isAuthenticated, router]);

  const startSimulation = () => {
    setSimulationRunning(true);
    setUploadProgress(0);
    setProcessingProgress(0);

    // Simulate upload progress
    const uploadInterval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(uploadInterval);
          return 100;
        }
        return prev + 5;
      });
    }, 200);

    // Simulate processing progress (starts after 1 second)
    setTimeout(() => {
      const processingInterval = setInterval(() => {
        setProcessingProgress((prev) => {
          if (prev >= 100) {
            clearInterval(processingInterval);
            setSimulationRunning(false);
            return 100;
          }
          return prev + 2;
        });
      }, 300);
    }, 1000);
  };

  const resetSimulation = () => {
    setUploadProgress(0);
    setProcessingProgress(0);
    setSimulationRunning(false);
  };

  if (!user) {
    return null;
  }

  return (
    <DashboardLayout>
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="flex mb-6" aria-label="Breadcrumb">
          <ol className="inline-flex items-center space-x-1 md:space-x-3">
            <li className="inline-flex items-center">
              <a href="/dashboard" className="text-gray-500 hover:text-gray-700">
                Home
              </a>
            </li>
            <li>
              <div className="flex items-center">
                <svg className="w-4 h-4 text-gray-400 mx-1" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                <span className="text-gray-700 font-medium">Progress Bar Demo</span>
              </div>
            </li>
          </ol>
        </nav>

        {/* Page Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Progress Bar Component Demo</h2>
          <p className="text-gray-600">
            Demonstration of progress bar variants and functionality
          </p>
        </div>

        {/* Demo Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Document Processing Simulation</h3>
          <div className="space-y-6">
            <ProgressBar
              progress={uploadProgress}
              label="Uploading document"
              variant="primary"
              size="md"
            />
            <ProgressBar
              progress={processingProgress}
              label="Processing with AI"
              variant="success"
              size="md"
            />
            <div className="flex gap-4">
              <button
                onClick={startSimulation}
                disabled={simulationRunning}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {simulationRunning ? 'Processing...' : 'Start Simulation'}
              </button>
              <button
                onClick={resetSimulation}
                disabled={simulationRunning}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Variant Examples */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Progress Bar Variants</h3>
          <div className="space-y-6">
            <ProgressBar progress={75} label="Primary variant" variant="primary" />
            <ProgressBar progress={50} label="Success variant" variant="success" />
            <ProgressBar progress={25} label="Warning variant" variant="warning" />
            <ProgressBar progress={90} label="Error variant" variant="error" />
          </div>
        </div>

        {/* Size Examples */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Progress Bar Sizes</h3>
          <div className="space-y-6">
            <ProgressBar progress={60} label="Small size" size="sm" />
            <ProgressBar progress={60} label="Medium size (default)" size="md" />
            <ProgressBar progress={60} label="Large size" size="lg" />
          </div>
        </div>

        {/* Special States */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Special States</h3>
          <div className="space-y-6">
            <ProgressBar progress={45} label="With percentage" showPercentage={true} />
            <ProgressBar progress={45} label="Without percentage" showPercentage={false} />
            <ProgressBar progress={0} label="Indeterminate loading" indeterminate={true} />
            <ProgressBar progress={100} label="Completed" variant="success" />
          </div>
        </div>

        {/* Usage Examples */}
        <div className="bg-gray-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Use Cases</h3>
          <ul className="space-y-2 text-gray-700">
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Document upload and processing
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Knowledge graph extraction progress
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Sync operations from SharePoint/OneDrive
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-600 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Batch operations and bulk processing
            </li>
          </ul>
        </div>
      </div>
    </DashboardLayout>
  );
}
