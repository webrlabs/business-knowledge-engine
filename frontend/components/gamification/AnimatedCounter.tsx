'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

export default function AnimatedCounter({
  value,
  duration = 800,
  prefix,
  suffix,
  className,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const spanRef = useRef<HTMLSpanElement>(null);
  const previousValue = useRef(0);
  const hasBeenVisible = useRef(false);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const element = spanRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasBeenVisible.current) {
          hasBeenVisible.current = true;
          animateValue(0, value);
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
    };
    // Only trigger on mount for visibility detection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle value changes after initial render
  useEffect(() => {
    if (!hasBeenVisible.current) return;

    // Only re-animate if the value actually changed
    if (value !== previousValue.current) {
      animateValue(previousValue.current, value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function animateValue(from: number, to: number) {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;

      setDisplayValue(Math.round(current));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        previousValue.current = to;
        animationRef.current = null;
      }
    }

    animationRef.current = requestAnimationFrame(tick);
  }

  return (
    <span ref={spanRef} className={className}>
      {prefix}
      {displayValue.toLocaleString()}
      {suffix}
    </span>
  );
}
