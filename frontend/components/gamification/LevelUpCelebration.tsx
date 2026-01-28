'use client';

import { useEffect, useState } from 'react';

interface LevelUpCelebrationProps {
  show: boolean;
  newLevelName: string;
  onClose: () => void;
}

export default function LevelUpCelebration({
  show,
  newLevelName,
  onClose,
}: LevelUpCelebrationProps) {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    if (show) {
      setVisible(true);
      setFadeOut(false);

      const dismissTimer = setTimeout(() => {
        setFadeOut(true);
      }, 3500);

      const removeTimer = setTimeout(() => {
        setVisible(false);
        onClose();
      }, 4000);

      return () => {
        clearTimeout(dismissTimer);
        clearTimeout(removeTimer);
      };
    } else {
      setFadeOut(true);
      const timer = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  const handleDismiss = () => {
    setFadeOut(true);
    setTimeout(() => {
      setVisible(false);
      onClose();
    }, 400);
  };

  if (!visible) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 flex items-center justify-center
        backdrop-blur-sm bg-black/50
        transition-opacity duration-400 ease-out
        ${fadeOut ? 'opacity-0' : 'opacity-100'}
      `}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={`Level up celebration: ${newLevelName}`}
    >
      {/* Confetti particles - CSS only */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 30 }).map((_, i) => (
          <span
            key={i}
            className="absolute block rounded-sm animate-confetti"
            style={{
              width: `${6 + Math.random() * 8}px`,
              height: `${6 + Math.random() * 8}px`,
              left: `${Math.random() * 100}%`,
              top: `-5%`,
              backgroundColor: [
                '#3b82f6',
                '#8b5cf6',
                '#ec4899',
                '#f59e0b',
                '#10b981',
                '#6366f1',
                '#f43f5e',
                '#06b6d4',
              ][i % 8],
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${2.5 + Math.random() * 2}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        ))}
      </div>

      {/* Center content */}
      <div
        className={`
          relative flex flex-col items-center gap-4 p-10
          transition-all duration-500 ease-out
          ${fadeOut ? 'scale-90 opacity-0' : 'scale-100 opacity-100'}
        `}
        style={{ animationFillMode: 'both' }}
      >
        {/* Glow ring */}
        <div className="absolute inset-0 -m-8 rounded-full bg-gradient-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-3xl animate-pulse" />

        {/* Star burst icon */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full blur-xl opacity-60 animate-pulse" />
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 flex items-center justify-center shadow-2xl shadow-amber-500/40">
            <svg
              className="w-10 h-10 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
        </div>

        {/* Level Up title with glow */}
        <h2
          className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400"
          style={{
            textShadow: '0 0 40px rgba(139, 92, 246, 0.5), 0 0 80px rgba(139, 92, 246, 0.3)',
            filter: 'drop-shadow(0 0 20px rgba(139, 92, 246, 0.4))',
          }}
        >
          Level Up!
        </h2>

        {/* New level name */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm font-medium text-gray-300">
            You&apos;ve reached
          </p>
          <p className="text-2xl font-bold text-white">
            {newLevelName}
          </p>
        </div>

        {/* Dismiss hint */}
        <p className="text-xs text-gray-400 mt-2">
          Click anywhere to dismiss
        </p>
      </div>

      {/* Confetti keyframes injected via style tag */}
      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg) scale(0.3);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti-fall linear forwards;
        }
      `}</style>
    </div>
  );
}
