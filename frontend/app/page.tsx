'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest } from '@/lib/auth-config';

export default function Home() {
  const router = useRouter();
  const { instance } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const isConfigured = Boolean(process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, router]);

  const validateEmail = (value: string): string => {
    if (!value) {
      return '';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return 'Please enter a valid email address';
    }
    return '';
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (emailTouched) {
      setEmailError(validateEmail(value));
    }
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    setEmailError(validateEmail(email));
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    setEmailTouched(true);
    const emailErr = validateEmail(email);
    setEmailError(emailErr);

    if (emailErr) {
      return;
    }

    setLoading(true);

    try {
      if (!isConfigured) {
        setError('Entra ID is not configured. Set NEXT_PUBLIC_AZURE_AD_CLIENT_ID.');
        return;
      }
      await instance.loginRedirect({
        ...loginRequest,
        loginHint: email || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-secondary-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Business Process Knowledge Platform
          </h1>
          <p className="text-gray-600">
            Enterprise Azure Edition
          </p>
        </div>

        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 font-semibold mb-2">
            Microsoft Entra ID Sign-In
          </p>
          <p className="text-xs text-blue-700 mb-2">
            Use your organizational account to authenticate.
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
              Email Address (optional)
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => handleEmailChange(e.target.value)}
              onBlur={handleEmailBlur}
              className={`w-full px-4 py-2 border rounded-lg focus:ring-2 focus:border-transparent text-gray-900 transition-colors ${
                emailError && emailTouched
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }`}
              placeholder="user@contoso.com"
              aria-invalid={emailError && emailTouched ? 'true' : 'false'}
              aria-describedby={emailError && emailTouched ? 'email-error' : undefined}
            />
            {emailError && emailTouched && (
              <p id="email-error" className="mt-1 text-sm text-red-600 flex items-start">
                <svg className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {emailError}
              </p>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !isConfigured}
            className="btn-primary w-full"
          >
            {loading ? 'Redirecting...' : 'Sign In with Entra ID'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Powered by Microsoft Entra ID
          </p>
        </div>
      </div>
    </div>
  );
}
