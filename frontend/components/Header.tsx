'use client';

import { useRouter } from 'next/navigation';
import { useAuth, AuthUser } from '@/lib/auth';
import { brandConfig, getButtonClasses } from '@/lib/brand-config';

interface HeaderProps {
  user?: AuthUser | null;
  showLogout?: boolean;
  showBackButton?: boolean;
  backButtonText?: string;
  backButtonPath?: string;
}

export default function Header({
  user,
  showLogout = true,
  showBackButton = false,
  backButtonText = 'Back to Dashboard',
  backButtonPath = '/dashboard',
}: HeaderProps) {
  const router = useRouter();
  const { logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const handleBack = () => {
    router.push(backButtonPath);
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className={`${brandConfig.layout.maxWidth} mx-auto ${brandConfig.layout.padding} py-4`}>
        <div className="flex items-center justify-between">
          {/* Brand/Logo */}
          <div>
            <div className="flex items-center space-x-3">
              {/* Logo Icon */}
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-lg">{brandConfig.logo.text}</span>
              </div>
              {/* App Name */}
              <div>
                <h1 className={`${brandConfig.typography.headings.h2} text-gray-900`}>
                  {brandConfig.appName}
                </h1>
                <p className="text-sm text-gray-600">{brandConfig.appEdition}</p>
              </div>
            </div>
          </div>

          {/* User Info and Actions */}
          <div className="flex items-center space-x-4">
            {user && (
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-600">{user.email}</p>
              </div>
            )}

            {showBackButton && (
              <button
                onClick={handleBack}
                className={getButtonClasses('secondary')}
              >
                {backButtonText}
              </button>
            )}

            {showLogout && user && (
              <button
                onClick={handleLogout}
                className={getButtonClasses('danger')}
              >
                Sign Out
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
