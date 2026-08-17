"use client";

import { useEffect, useState } from "react";

/**
 * Conic-gradient progress ring that draws itself on mount.
 * `--p` is a registered CSS property (see globals.css) so the arc
 * animates from 0 to `percent` instead of jumping.
 */
export function ProgressRing({
  percent,
  size = 96,
  thickness = 11,
  children,
}: {
  percent: number;
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const [p, setP] = useState(0);
  useEffect(() => {
    // Next frame so the transition from 0% is observable.
    const id = requestAnimationFrame(() => setP(Math.max(0, Math.min(100, percent))));
    return () => cancelAnimationFrame(id);
  }, [percent]);

  return (
    <div
      className="ring grid place-items-center rounded-full"
      style={{ width: size, height: size, ["--p" as string]: `${p}%` }}
      role="img"
      aria-label={`${Math.round(percent)} percent complete`}
    >
      <div
        className="grid place-items-center rounded-full bg-chrome-card"
        style={{ width: size - thickness * 2, height: size - thickness * 2 }}
      >
        {children}
      </div>
    </div>
  );
}

/** Counts up to `target` on mount; respects prefers-reduced-motion. */
export function useCountUp(target: number, duration = 750): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const reduced =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (reduced) {
        setValue(target);
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const n = useCountUp(value);
  return <span className={className}>{n}</span>;
}
