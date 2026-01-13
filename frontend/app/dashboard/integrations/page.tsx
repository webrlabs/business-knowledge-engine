'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Tooltip from '@/components/Tooltip';
import { useToast, ToastContainer } from '@/components/Toast';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  status: 'connected' | 'disconnected';
  type: 'sharepoint' | 'onedrive';
}

export default function IntegrationsPage() {
  const router = useRouter();
  const toast = useToast();
  const [integrations, setIntegrations] = useState<Integration[]>([
    {
      id: 'sharepoint',
      name: 'SharePoint Online',
      description: 'Connect to SharePoint Online document libraries for automated content ingestion',
      icon: (
        <svg className="w-12 h-12 text-blue-600 dark:text-blue-400" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21.17 10.25l-5.98-1.5a7.97 7.97 0 0 0-.86-2.07l3.47-5.18a.75.75 0 0 0-.18-.98l-1.98-1.98a.75.75 0 0 0-.98-.18l-5.18 3.47a7.97 7.97 0 0 0-2.07-.86l-1.5-5.98A.75.75 0 0 0 5.25 0h-2.5a.75.75 0 0 0-.73.57l-1.5 5.98a7.97 7.97 0 0 0-2.07.86L-6.73 3.94a.75.75 0 0 0-.98.18L-9.69 6.1a.75.75 0 0 0-.18.98l3.47 5.18a7.97 7.97 0 0 0-.86 2.07l-5.98 1.5a.75.75 0 0 0-.57.73v2.88a.75.75 0 0 0 .57.73l5.98 1.5c.21.75.5 1.45.86 2.07l-3.47 5.18a.75.75 0 0 0 .18.98l1.98 1.98a.75.75 0 0 0 .98.18l5.18-3.47c.62.36 1.32.65 2.07.86l1.5 5.98a.75.75 0 0 0 .73.57h2.88a.75.75 0 0 0 .73-.57l1.5-5.98c.75-.21 1.45-.5 2.07-.86l5.18 3.47a.75.75 0 0 0 .98-.18l1.98-1.98a.75.75 0 0 0 .18-.98l-3.47-5.18c.36-.62.65-1.32.86-2.07l5.98-1.5a.75.75 0 0 0 .57-.73v-2.88a.75.75 0 0 0-.57-.73zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z"/>
        </svg>
      ),
      status: 'disconnected',
      type: 'sharepoint',
    },
    {
      id: 'onedrive',
      name: 'OneDrive for Business',
      description: 'Sync documents from OneDrive for Business folders',
      icon: (
        <svg className="w-12 h-12 text-blue-500 dark:text-blue-300" fill="currentColor" viewBox="0 0 24 24">
          <path d="M15.5 2.25a5.73 5.73 0 0 0-4.47 2.13A5.73 5.73 0 0 0 6.56 2.25a5.75 5.75 0 0 0-5.75 5.75c0 .57.09 1.13.26 1.67A4.5 4.5 0 0 0 3.75 18h12a4.5 4.5 0 0 0 2.68-8.13 5.73 5.73 0 0 0 .32-1.87 5.75 5.75 0 0 0-3.25-5.75z"/>
        </svg>
      ),
      status: 'disconnected',
      type: 'onedrive',
    },
  ]);

  const [showSharePointDialog, setShowSharePointDialog] = useState(false);
  const [showOneDriveDialog, setShowOneDriveDialog] = useState(false);

  const [sharePointConfig, setSharePointConfig] = useState({
    siteUrl: '',
    libraryName: '',
    syncType: 'incremental' as 'incremental' | 'full',
  });

  const [oneDriveConfig, setOneDriveConfig] = useState({
    folderPath: '',
    syncFrequency: 'hourly' as 'hourly' | 'daily' | 'weekly',
  });

  const handleConnect = (type: 'sharepoint' | 'onedrive') => {
    if (type === 'sharepoint') {
      setShowSharePointDialog(true);
    } else {
      setShowOneDriveDialog(true);
    }
  };

  const handleSharePointConnect = async () => {
    // SharePoint integration is coming soon
    toast.info('Coming Soon', 'SharePoint integration is not yet available. This feature is under development.');
    setShowSharePointDialog(false);
  };

  const handleOneDriveConnect = async () => {
    // OneDrive integration is coming soon
    toast.info('Coming Soon', 'OneDrive integration is not yet available. This feature is under development.');
    setShowOneDriveDialog(false);
  };

  const handleDisconnect = (id: string) => {
    setIntegrations(prev =>
      prev.map(int =>
        int.id === id ? { ...int, status: 'disconnected' as const } : int
      )
    );
    toast.info('Disconnected', 'Integration disconnected successfully');
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Integrations</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Connect external data sources to automatically ingest and process documents
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {integrations.map((integration) => (
          <div
            key={integration.id}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center">
                {integration.icon}
                <div className="ml-4">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {integration.name}
                  </h3>
                  <span
                    className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full mt-1 ${
                      integration.status === 'connected'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                  >
                    {integration.status === 'connected' ? (
                      <>
                        <svg
                          className="w-3 h-3 mr-1"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Connected
                      </>
                    ) : (
                      'Disconnected'
                    )}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-gray-600 dark:text-gray-400 mb-4">
              {integration.description}
            </p>

            <div className="flex gap-2">
              {integration.status === 'disconnected' ? (
                <button
                  onClick={() => handleConnect(integration.type)}
                  className="btn-primary btn-sm flex-1"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                  Connect
                </button>
              ) : (
                <>
                  <button
                    onClick={() => handleDisconnect(integration.id)}
                    className="btn-secondary btn-sm flex-1"
                  >
                    Disconnect
                  </button>
                  <Tooltip content="Configure sync settings">
                    <button className="btn-secondary btn-sm">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* SharePoint Dialog */}
      {showSharePointDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Connect SharePoint Online
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  SharePoint Site URL <span className="text-red-500">*</span>
                </label>
                <input
                  type="url"
                  value={sharePointConfig.siteUrl}
                  onChange={(e) =>
                    setSharePointConfig({ ...sharePointConfig, siteUrl: e.target.value })
                  }
                  placeholder="https://contoso.sharepoint.com/sites/YourSite"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Document Library Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={sharePointConfig.libraryName}
                  onChange={(e) =>
                    setSharePointConfig({ ...sharePointConfig, libraryName: e.target.value })
                  }
                  placeholder="Documents"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sync Type
                </label>
                <select
                  value={sharePointConfig.syncType}
                  onChange={(e) =>
                    setSharePointConfig({
                      ...sharePointConfig,
                      syncType: e.target.value as 'incremental' | 'full',
                    })
                  }
                  className="input-field"
                >
                  <option value="incremental">Incremental (changes only)</option>
                  <option value="full">Full (all documents)</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowSharePointDialog(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button onClick={handleSharePointConnect} className="btn-primary flex-1">
                Start Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OneDrive Dialog */}
      {showOneDriveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Connect OneDrive for Business
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Folder Path <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={oneDriveConfig.folderPath}
                  onChange={(e) =>
                    setOneDriveConfig({ ...oneDriveConfig, folderPath: e.target.value })
                  }
                  placeholder="/Business Documents"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Sync Frequency
                </label>
                <select
                  value={oneDriveConfig.syncFrequency}
                  onChange={(e) =>
                    setOneDriveConfig({
                      ...oneDriveConfig,
                      syncFrequency: e.target.value as 'hourly' | 'daily' | 'weekly',
                    })
                  }
                  className="input-field"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowOneDriveDialog(false)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button onClick={handleOneDriveConnect} className="btn-primary flex-1">
                Enable Sync
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toast.toasts} onDismiss={toast.dismissToast} />
    </div>
  );
}
