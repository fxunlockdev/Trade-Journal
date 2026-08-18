"use client";

import { useEffect, type RefObject } from "react";

/**
 * The FXNUHOME Apple-style scroll choreography.
 *
 * - Devices settle from a tilted, scaled-back pose to flat as they rise through
 *   the viewport (scroll-scrubbed, lerped every frame).
 * - The hero copy parallaxes up and fades as the product comes forward.
 * - The hero device leans slightly toward the cursor.
 * - Word-stagger split for [data-split] headings, reveal-on-scroll, and the
 *   cursor-tracked spotlight on .spot cards.
 *
 * Three rules keep it from moving the page out from under the reader:
 *
 * 1. Handlers never touch layout. Scroll, resize and pointer events only record
 *    a value and flag the frame dirty; every getBoundingClientRect happens in
 *    one batch at the top of a frame, before a single style is written.
 *    Interleaving reads and writes is what makes scroll-linked motion stutter,
 *    and the old version measured every tilted element on every pointermove.
 * 2. The loop halts. A lerp approaches its target asymptotically and never
 *    arrives, so an unguarded rAF keeps nudging pixels long after the reader has
 *    stopped -- which is felt as the page drifting on its own. Once every value
 *    is within epsilon we snap to target, drop will-change and cancel the frame.
 * 3. Parallax is bounded. Hero travel is capped at a fraction of the viewport
 *    rather than growing with scrollY forever, so a fast scroll can't leave a
 *    second of catch-up sliding behind it.
 *
 * Honours prefers-reduced-motion: everything is shown immediately, no loop.
 */

/** Lerp factor corrected for frame time, so 60Hz and 120Hz settle alike. */
export function damp(base: number, dtMs: number): number {
  return 1 - Math.pow(1 - base, Math.min(dtMs, 50) / 16.667);
}

/**
 * Hero parallax, bounded.
 *
 * Travel completes within the first viewport of scrolling and then holds. The
 * previous form was `scrollY * 0.3`, which grows without limit: scrolling a few
 * thousand pixels asked the hero to travel several hundred more, and the lerp
 * then spent a visible second catching up after the reader had already stopped.
 * That was felt as the page drifting on its own.
 *
 * Exported so the bound is a tested invariant rather than a comment.
 */
export function heroParallax(scrollY: number, vh: number): { y: number; opacity: number } {
  if (vh <= 0) return { y: 0, opacity: 1 };
  const p = Math.min(Math.max(scrollY, 0) / (vh * 0.85), 1);
  return { y: p * vh * 0.22, opacity: 1 - p * 0.75 };
}

interface TiltItem {
  readonly el: HTMLElement;
  readonly hero: boolean;
  rx: number; s: number; ty: number; ry: number;
  tgtRx: number; tgtS: number; tgtTy: number; tgtRy: number;
  near: boolean;
}

// Below these deltas a change is invisible, so we snap and stop rather than
// chase the asymptote forever.
const EPS_ANGLE = 0.02;   // degrees
const EPS_SCALE = 0.0004;
const EPS_PX = 0.06;
const EPS_OPACITY = 0.002;

export function useAppleMotion(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // ── Split [data-split] headings into per-word spans ──────────────
    root.querySelectorAll<HTMLElement>("[data-split]").forEach((el) => {
      if (el.dataset.splitDone === "1") return;
      const nodes = Array.from(el.childNodes);
      let wi = 0;
      el.textContent = "";
      for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          for (const part of (node.textContent ?? "").split(/(\s+)/)) {
            if (!part) continue;
            if (/^\s+$/.test(part)) {
              el.appendChild(document.createTextNode(part));
              continue;
            }
            const s = document.createElement("span");
            s.className = "w";
            s.style.setProperty("--wi", String(wi++));
            s.textContent = part;
            el.appendChild(s);
          }
        } else {
          el.appendChild(node); // keep <br> etc.
        }
      }
      el.dataset.splitDone = "1";
    });

    const revealEls = root.querySelectorAll<HTMLElement>(".reveal");

    if (reduced) {
      revealEls.forEach((el) => el.classList.add("in"));
      return;
    }

    const cleanups: Array<() => void> = [];

    // Reveal-on-scroll is geometry-driven rather than IntersectionObserver-only.
    // IO alone leaves content stuck at opacity:0 whenever it doesn't fire for
    // already-visible elements: deep links to #anchors, a restored scroll
    // position, or environments that throttle observers. A rect check always
    // agrees with what the reader can actually see, and elements drop out of
    // `pending` once revealed, so the work shrinks to nothing.
    const pending = new Set<HTMLElement>(revealEls);
    const nav = root.querySelector<HTMLElement>(".nav");
    const heroInner = root.querySelector<HTMLElement>(".hero-inner");

    const tiltItems: TiltItem[] = Array.from(
      root.querySelectorAll<HTMLElement>("[data-tilt]"),
    ).map((el) => ({
      el,
      hero: el.hasAttribute("data-hero"),
      rx: 14, s: 0.94, ty: 26, ry: 0,
      tgtRx: 14, tgtS: 0.94, tgtTy: 26, tgtRy: 0,
      near: true,
    }));

    const hero = { y: 0, o: 1, tgtY: 0, tgtO: 1 };
    let mouseX = 0.5;
    let rafId = 0;
    let running = false;
    let dirty = true;
    let lastTs = 0;

    // Content visibility runs synchronously on the scroll event and NEVER inside
    // the animation frame. rAF is suspended in background tabs, in low-power
    // modes and in some embedded webviews; hanging reveals off it leaves the
    // whole page sitting at opacity:0 in exactly those environments. Reads are
    // batched and the class writes happen after them, so there is no thrash.
    function syncReveals(): void {
      if (pending.size === 0) return;
      const vh = window.innerHeight;
      const hit: HTMLElement[] = [];
      for (const el of pending) {
        const r = el.getBoundingClientRect();
        // Visible if any part is in view, minus the 6% bottom margin the
        // original design used to delay the trigger slightly.
        if (r.top < vh * 0.94 && r.bottom > 0) hit.push(el);
      }
      for (const el of hit) {
        el.classList.add("in");
        pending.delete(el);
      }
    }

    // Cheap and purely visual, but it belongs with the reveals rather than the
    // lerp: the reader should never see an unstyled nav because rAF is asleep.
    function syncNav(): void {
      nav?.classList.toggle("scrolled", window.scrollY > 8);
    }

    // ── READ phase: every layout read for the frame, in one batch ────
    function measure(): void {
      const vh = window.innerHeight;
      const sy = window.scrollY;

      for (const it of tiltItems) {
        const r = it.el.getBoundingClientRect();
        it.near = r.bottom > -160 && r.top < vh + 160;
        if (!it.near) continue;
        const center = r.top + r.height / 2;
        // progress 0 → 1 as the device rises toward the upper-middle of the view
        const p = 1 - Math.min(Math.max((center - vh * 0.4) / (vh * 0.62), 0), 1);
        it.tgtRx = (1 - p) * 14;            // rotateX 14° → 0°
        it.tgtS = 0.94 + p * 0.06;          // scale .94 → 1
        it.tgtTy = (1 - p) * 30;            // translateY 30px → 0
        it.tgtRy = it.hero ? (mouseX - 0.5) * 3.5 : 0; // hero leans to cursor
      }

      if (heroInner) {
        const { y, opacity } = heroParallax(sy, vh);
        hero.tgtY = y;
        hero.tgtO = opacity;
      }
    }

    // ── WRITE phase: no reads past this point. Returns "still moving". ──
    function write(dt: number): boolean {
      const k = damp(0.16, dt);
      const kRot = damp(0.11, dt);
      let moving = false;

      for (const it of tiltItems) {
        if (!it.near) continue;
        const dRx = it.tgtRx - it.rx;
        const dS = it.tgtS - it.s;
        const dTy = it.tgtTy - it.ty;
        const dRy = it.tgtRy - it.ry;

        if (
          Math.abs(dRx) < EPS_ANGLE && Math.abs(dS) < EPS_SCALE &&
          Math.abs(dTy) < EPS_PX && Math.abs(dRy) < EPS_ANGLE
        ) {
          it.rx = it.tgtRx; it.s = it.tgtS; it.ty = it.tgtTy; it.ry = it.tgtRy;
        } else {
          it.rx += dRx * k;
          it.s += dS * k;
          it.ty += dTy * k;
          it.ry += dRy * kRot;
          moving = true;
        }

        it.el.style.transform =
          `perspective(1200px) rotateX(${it.rx.toFixed(3)}deg) rotateY(${it.ry.toFixed(3)}deg)` +
          ` translateY(${it.ty.toFixed(2)}px) scale(${it.s.toFixed(4)})`;
      }

      if (heroInner) {
        const dY = hero.tgtY - hero.y;
        const dO = hero.tgtO - hero.o;
        if (Math.abs(dY) < EPS_PX && Math.abs(dO) < EPS_OPACITY) {
          hero.y = hero.tgtY; hero.o = hero.tgtO;
        } else {
          hero.y += dY * k;
          hero.o += dO * k;
          moving = true;
        }
        heroInner.style.transform = `translate3d(0, ${hero.y.toFixed(2)}px, 0)`;
        heroInner.style.opacity = hero.o.toFixed(3);
      }

      return moving;
    }

    // will-change costs a compositor layer for as long as it is set, so it is
    // held only while something is actually animating.
    function setLive(on: boolean): void {
      for (const it of tiltItems) it.el.style.willChange = on ? "transform" : "auto";
      if (heroInner) heroInner.style.willChange = on ? "transform, opacity" : "auto";
    }

    function frame(ts: number): void {
      const dt = lastTs === 0 ? 16.667 : ts - lastTs;
      lastTs = ts;
      if (dirty) { measure(); dirty = false; }
      if (write(dt)) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      running = false;
      rafId = 0;
      lastTs = 0;
      setLive(false);
    }

    function kick(): void {
      dirty = true;
      if (running) return;
      running = true;
      lastTs = 0;
      setLive(true);
      rafId = requestAnimationFrame(frame);
    }

    const onScroll = () => { syncReveals(); syncNav(); kick(); };
    const onResize = () => { syncReveals(); syncNav(); kick(); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    });

    // Only worth tracking the cursor if something actually leans toward it.
    if (tiltItems.some((it) => it.hero)) {
      const onPointerMove = (e: PointerEvent) => {
        mouseX = e.clientX / window.innerWidth;
        kick();
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      cleanups.push(() => window.removeEventListener("pointermove", onPointerMove));
    }

    // ── Spotlight (cursor-tracked radial) on .spot cards ─────────────
    // The card's rect is cached on enter instead of measured on every move,
    // which would force a layout per pointer event.
    const spotInvalidators: Array<() => void> = [];
    root.querySelectorAll<HTMLElement>(".spot").forEach((card) => {
      let rect: DOMRect | null = null;
      const onEnter = () => { rect = card.getBoundingClientRect(); };
      const onMove = (e: PointerEvent) => {
        if (!rect) rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - rect.left}px`);
        card.style.setProperty("--my", `${e.clientY - rect.top}px`);
      };
      const onLeave = () => { rect = null; };
      card.addEventListener("pointerenter", onEnter);
      card.addEventListener("pointermove", onMove, { passive: true });
      card.addEventListener("pointerleave", onLeave);
      spotInvalidators.push(onLeave); // a scroll moves the card under the cursor
      cleanups.push(() => {
        card.removeEventListener("pointerenter", onEnter);
        card.removeEventListener("pointermove", onMove);
        card.removeEventListener("pointerleave", onLeave);
      });
    });
    if (spotInvalidators.length > 0) {
      const dropSpotRects = () => { for (const fn of spotInvalidators) fn(); };
      window.addEventListener("scroll", dropSpotRects, { passive: true });
      cleanups.push(() => window.removeEventListener("scroll", dropSpotRects));
    }

    // Reveal what is already on screen, then re-check once layout has settled:
    // at effect time fonts and images are often still loading and the viewport
    // can briefly measure 0 during hydration, which would strand above-the-fold
    // content at opacity:0. The timer backs up the frame callback so this still
    // holds where rAF is throttled.
    syncReveals();
    syncNav();
    kick();
    const firstPaint = requestAnimationFrame(() => { syncReveals(); kick(); });
    const settle = setTimeout(() => { syncReveals(); syncNav(); }, 150);
    cleanups.push(() => {
      cancelAnimationFrame(firstPaint);
      clearTimeout(settle);
    });

    cleanups.push(() => {
      if (rafId) cancelAnimationFrame(rafId);
      setLive(false);
    });

    return () => cleanups.forEach((c) => c());
  }, [rootRef]);
}
