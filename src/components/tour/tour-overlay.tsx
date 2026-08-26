"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { placeTooltip, type Placed, type Rect } from "@/lib/tour/position";
import type { TourStep } from "@/lib/tour/steps";

interface TourOverlayProps {
  readonly steps: readonly TourStep[];
  readonly onFinish: () => void;
}

/** Padding around the highlighted element so the spotlight isn't skin-tight. */
const SPOTLIGHT_PAD = 6;

function readRect(target: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // A zero-size box means the element is present but not laid out (a collapsed
  // sidebar, a closed drawer). Spotlighting it would dim the screen around
  // nothing.
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Spotlight tour overlay.
 *
 * Dims the page and cuts a hole around the current step's target, with a
 * tooltip beside it. Positions are recomputed on scroll and resize because the
 * target is real page furniture, not a copy — the hole has to keep tracking it.
 */
export function TourOverlay({ steps, onFinish }: TourOverlayProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const finish = useCallback(() => {
    onFinish();
  }, [onFinish]);

  const next = useCallback(() => {
    if (isLast) finish();
    else setIndex((i) => i + 1);
  }, [isLast, finish]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Measure the target, then the tooltip, then place it. useLayoutEffect so the
  // tooltip never paints at 0,0 before being positioned.
  useLayoutEffect(() => {
    if (!step) return;

    const measure = () => {
      const r = readRect(step.target);
      setRect(r);
      if (!r) {
        setPlaced(null);
        return;
      }
      const tip = tipRef.current;
      const size = tip
        ? { width: tip.offsetWidth, height: tip.offsetHeight }
        : { width: 320, height: 180 };
      setPlaced(
        placeTooltip(step.placement, r, size, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };

    measure();
    // A second pass on the next frame: the first run measures the tooltip
    // before its text has wrapped, so the height can be wrong by a line.
    const raf = requestAnimationFrame(measure);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Keyboard: Escape always exits (never trap someone in a tutorial), arrows
  // and Enter advance.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish, next, back]);

  // Move focus into the tooltip so a screen reader lands on the step text and
  // the keyboard handlers have somewhere sensible to fire from.
  useEffect(() => {
    tipRef.current?.focus();
  }, [index]);

  // The page behind is inert while the tour runs; restore on unmount.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (!step) return null;
  if (typeof document === "undefined") return null;

  const hole = rect
    ? {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      data-testid="tour-overlay"
    >
      {/*
        The dim is drawn by an enormous box-shadow on the hole rather than by
        four separate panels — one element, no seams, and it animates smoothly
        as the hole moves between steps.
      */}
      {hole ? (
        <div
          data-testid="tour-spotlight"
          // Deliberately NOT transitioned. A CSS transition on position
          // animates from the element's unpositioned origin the first time it
          // mounts, so the spotlight visibly slides in from the corner — which
          // reads as a glitch. Moving between steps is instant instead.
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary/70"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.66)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/66" />
      )}

      <div
        ref={tipRef}
        tabIndex={-1}
        data-testid="tour-tooltip"
        className="absolute w-[min(340px,calc(100vw-24px))] rounded-xl border border-border bg-card p-4 shadow-2xl outline-none"
        style={
          placed
            ? { top: placed.top, left: placed.left }
            : // No target: centre it and let the step read as a plain note.
              { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
        }
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
          Step {index + 1} of {steps.length}
        </p>
        <h2
          id="tour-title"
          className="mt-1 text-base font-semibold text-foreground"
        >
          {step.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={finish}
            data-testid="tour-skip"
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={back}
                data-testid="tour-back"
              >
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={next}
              data-testid="tour-next"
            >
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex justify-center gap-1.5" aria-hidden>
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-4 bg-primary" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
