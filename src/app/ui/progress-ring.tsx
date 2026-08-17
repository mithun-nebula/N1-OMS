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

/**
 * Three concentric activity rings, iOS-fitness style, for the day card.
 * Outer = finished ÷ committed · middle = finished inside estimate ÷ finished ·
 * inner = how full the day is. Each draws from 0 on mount via a
 * stroke-dashoffset transition.
 */
export function ThreeRings({
  outer,
  middle,
  inner,
  size = 132,
}: {
  outer: number;
  middle: number;
  inner: number;
  size?: number;
}) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const stroke = size * 0.085;
  const gap = stroke * 1.35;
  const c = size / 2;
  const rings = [
    { r: c - stroke / 2, pct: outer, color: "var(--accent)", track: "rgba(255,255,255,0.10)" },
    { r: c - stroke / 2 - gap, pct: middle, color: "var(--mint-strong)", track: "rgba(255,255,255,0.10)" },
    { r: c - stroke / 2 - gap * 2, pct: inner, color: "var(--lilac-strong)", track: "rgba(255,255,255,0.10)" },
  ];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Rings: ${Math.round(outer)}% finished, ${Math.round(middle)}% on time, day ${Math.round(inner)}% full`}
    >
      {rings.map((ring, i) => {
        const circ = 2 * Math.PI * ring.r;
        const pct = Math.max(0, Math.min(100, ring.pct));
        const offset = drawn ? circ * (1 - pct / 100) : circ;
        return (
          <g key={i} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={ring.r} fill="none" stroke={ring.track} strokeWidth={stroke} />
            <circle
              cx={c}
              cy={c}
              r={ring.r}
              fill="none"
              stroke={ring.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              style={{ transition: `stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1) ${i * 120}ms` }}
            />
          </g>
        );
      })}
    </svg>
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
