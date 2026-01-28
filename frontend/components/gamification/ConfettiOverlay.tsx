'use client';

import { useEffect, useState, useMemo } from 'react';

interface ConfettiOverlayProps {
  show: boolean;
  onComplete?: () => void;
  duration?: number;
}

const CONFETTI_COLORS = [
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#10b981', // green
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#f43f5e', // rose
];

interface Particle {
  id: number;
  left: string;
  width: number;
  height: number;
  color: string;
  delay: number;
  fallDuration: number;
  rotation: number;
  isCircle: boolean;
}

export default function ConfettiOverlay({
  show,
  onComplete,
  duration = 3000,
}: ConfettiOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);

  // Generate particles once per "show" cycle using a stable seed
  const particles: Particle[] = useMemo(() => {
    if (!show) return [];

    const count = 45;
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 2.22 + ((i * 7) % 13) * 3.1) % 100}%`,
      width: 5 + ((i * 3 + 2) % 7),
      height: 5 + ((i * 5 + 3) % 8),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: ((i * 67) % 1000) / 1000,
      fallDuration: 2 + ((i * 13) % 15) / 10,
      rotation: (i * 47) % 360,
      isCircle: i % 3 === 0,
    }));
  }, [show]);

  useEffect(() => {
    if (show) {
      setVisible(true);
      setFading(false);

      // Start fading near the end
      const fadeTimer = setTimeout(() => {
        setFading(true);
      }, duration - 600);

      // Fully hide and call onComplete
      const completeTimer = setTimeout(() => {
        setVisible(false);
        setFading(false);
        onComplete?.();
      }, duration);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(completeTimer);
      };
    } else {
      if (visible) {
        setFading(true);
        const timer = setTimeout(() => {
          setVisible(false);
          setFading(false);
        }, 600);
        return () => clearTimeout(timer);
      }
    }
  }, [show, duration, onComplete, visible]);

  if (!visible) return null;

  return (
    <div
      className={`
        fixed inset-0 z-50 overflow-hidden pointer-events-none
        transition-opacity duration-500 ease-out
        ${fading ? 'opacity-0' : 'opacity-100'}
      `}
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute block confetti-particle"
          style={{
            left: p.left,
            top: '-3%',
            width: `${p.width}px`,
            height: `${p.height}px`,
            backgroundColor: p.color,
            borderRadius: p.isCircle ? '50%' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.fallDuration}s`,
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}

      {/* CSS keyframes for the confetti fall animation */}
      <style jsx>{`
        @keyframes confetti-drop {
          0% {
            transform: translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          20% {
            opacity: 1;
          }
          100% {
            transform: translateY(105vh) rotate(720deg) scale(0.4);
            opacity: 0;
          }
        }
        .confetti-particle {
          animation: confetti-drop ease-in forwards;
        }
      `}</style>
    </div>
  );
}
