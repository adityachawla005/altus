"use client";
import { useEffect, useRef, useState } from "react";
import Amphitheatre from "./Amphitheatre";

/**
 * The loading screen. The amphitheatre draws itself in as the counter runs.
 *
 * Progress is honest about being an estimate: it eases toward 92% on a curve
 * that slows as it climbs, and only completes when `done` actually flips.
 * A stalled backend therefore parks at 92 rather than lying about 100.
 */
export default function Loader({
  done,
  label = "Altus",
  steps = ["Opening the ledger", "Reading the passport", "Checking policy"],
  onGone,
}: {
  done: boolean;
  label?: string;
  steps?: string[];
  onGone?: () => void;
}) {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const doneRef = useRef(done);
  doneRef.current = done;

  useEffect(() => {
    let raf = 0;
    let v = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      // Approach 92 asymptotically; sprint to 100 once the data has landed.
      const ceiling = doneRef.current ? 100 : 92;
      v += (ceiling - v) * Math.min(dt * (doneRef.current ? 6 : 1.15), 1);
      setPct(v);
      if (v > 99.4 && doneRef.current) {
        setPct(100);
        setLeaving(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setGone(true);
      onGone?.();
    }, 780);
    return () => clearTimeout(t);
  }, [leaving, onGone]);

  if (gone) return null;

  // The last step is the "done" one, so hold it back until the counter has
  // actually arrived — otherwise the screen claims "Ready" at 87%.
  const step =
    pct >= 99.5
      ? steps[steps.length - 1]
      : steps[Math.min(steps.length - 2, Math.floor((pct / 100) * (steps.length - 1)))] ??
        steps[0];

  return (
    <div
      className="fixed inset-0 z-[100] bg-paper transition-[clip-path,opacity] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        clipPath: leaving ? "inset(0 0 100% 0)" : "inset(0 0 0% 0)",
        opacity: leaving ? 0.7 : 1,
      }}
    >
      <div className="graph absolute inset-0 opacity-70" />

      <Amphitheatre
        progress={pct / 100}
        spin={0.5}
        tilt={0.34}
        distance={31}
        className="absolute inset-0"
      />

      {/* Counter, top right — the one number on the screen, set as large as
          a headline because it is the headline. */}
      <div className="absolute right-[clamp(1.5rem,4vw,3.5rem)] top-[clamp(1.5rem,4vw,3rem)] text-right">
        <div className="display display-lg tabular-nums text-ink">
          {Math.round(pct)}
          <span className="text-muted">%</span>
        </div>
      </div>

      <div className="absolute left-[clamp(1.5rem,4vw,3.5rem)] top-[clamp(1.5rem,4vw,3rem)]">
        <p className="label tick label-ink">{label}</p>
        <p className="label mt-1">Est. MMXXIV · Bengaluru</p>
      </div>

      {/* Status line + the progress rule it drives. */}
      <div className="absolute bottom-[clamp(1.5rem,4vw,3rem)] left-[clamp(1.5rem,4vw,3.5rem)] right-[clamp(1.5rem,4vw,3.5rem)]">
        <div className="flex items-baseline justify-between gap-6">
          <p className="label label-ink">
            {step}
            <span className="blink">_</span>
          </p>
          <p className="label hidden sm:block">Loading structure · {Math.round(pct)}/100</p>
        </div>
        <div className="mt-3 h-px w-full bg-line">
          <div
            className="h-px bg-blue transition-[width] duration-150 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
