'use client';

import { useEffect, useState } from 'react';

/**
 * Toast Notification Component
 *
 * Displays success, error, warning, and info messages
 * Auto-dismisses after a configurable duration
 * Supports manual dismissal
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const duration = toast.duration || 5000;
    const timer = setTimeout(() => {
      handleDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [toast]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => {
      onDismiss(toast.id);
    }, 300);
  };

  const typeStyles = {
    success: {
      bg: 'bg-green-50 border-green-200',
      icon: '✓',
      iconBg: 'bg-green-500',
      text: 'text-green-800',
      title: 'text-green-900',
    },
    error: {
      bg: 'bg-red-50 border-red-200',
      icon: '✕',
      iconBg: 'bg-red-500',
      text: 'text-red-800',
      title: 'text-red-900',
    },
    warning: {
      bg: 'bg-yellow-50 border-yellow-200',
      icon: '⚠',
      iconBg: 'bg-yellow-500',
      text: 'text-yellow-800',
      title: 'text-yellow-900',
    },
    info: {
      bg: 'bg-blue-50 border-blue-200',
      icon: 'ℹ',
      iconBg: 'bg-blue-500',
      text: 'text-blue-800',
      title: 'text-blue-900',
    },
  };

  const style = typeStyles[toast.type];

  return (
    <div
      className={`${style.bg} border rounded-lg shadow-lg p-4 mb-3 max-w-md transform transition-all duration-300 ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      }`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start">
        <div className={`${style.iconBg} rounded-full w-6 h-6 flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
          {style.icon}
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`font-semibold ${style.title} text-sm`}>{toast.title}</h3>
          <p className={`${style.text} text-sm mt-1`}>{toast.message}</p>
          {toast.action && (
            <button
              onClick={toast.action.onClick}
              className={`${style.text} underline text-sm font-medium mt-2 hover:opacity-80`}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className={`${style.text} ml-3 hover:opacity-70 flex-shrink-0`}
          aria-label="Dismiss notification"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * ToastContainer Component
 *
 * Container for displaying multiple toast notifications
 * Positioned at top-right of the screen
 */

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 pointer-events-none">
      <div className="pointer-events-auto">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

/**
 * Toast Hook
 *
 * Custom hook for managing toast notifications
 */

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (
    type: ToastType,
    title: string,
    message: string,
    duration?: number,
    action?: { label: string; onClick: () => void }
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast: ToastMessage = {
      id,
      type,
      title,
      message,
      duration,
      action,
    };

    setToasts((prev) => [...prev, newToast]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const success = (title: string, message: string, duration?: number) => {
    showToast('success', title, message, duration);
  };

  const error = (title: string, message: string, duration?: number, action?: { label: string; onClick: () => void }) => {
    showToast('error', title, message, duration, action);
  };

  const warning = (title: string, message: string, duration?: number) => {
    showToast('warning', title, message, duration);
  };

  const info = (title: string, message: string, duration?: number) => {
    showToast('info', title, message, duration);
  };

  return {
    toasts,
    dismissToast,
    success,
    error,
    warning,
    info,
  };
}
