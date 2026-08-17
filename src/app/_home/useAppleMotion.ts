"use client";

import { useEffect, type RefObject } from "react";

/**
 * The FXNUHOME Apple-style scroll choreography, ported 1:1 from the original
 * site's js/main.js.
 *
 * - Devices settle from a tilted, scaled-back pose to flat as they rise through
 *   the viewport (scroll-scrubbed, lerped every frame).
 * - The hero copy parallaxes up and fades as the product comes forward.
 * - The hero device leans slightly toward the cursor.
 * - Word-stagger split for [data-split] headings, reveal-on-scroll, and the
 *   cursor-tracked spotlight on .spot cards.
 *
 * Honours prefers-reduced-motion: everything is shown immediately, no rAF loop.
 */
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
    const cleanups: Array<() => void> = [];

    if (reduced) {
      revealEls.forEach((el) => el.classList.add("in"));
      return;
    }

    // ── Reveal on scroll ─────────────────────────────────────────────
    // Geometry-driven rather than IntersectionObserver-only. IO alone leaves
    // content stuck at opacity:0 whenever it doesn't fire for already-visible
    // elements — deep links to #anchors, a restored scroll position, or
    // environments that throttle observers. A rect check on each scroll tick
    // always agrees with what the user can actually see. Elements drop out of
    // `pending` once revealed, so the work shrinks to zero.
    const pending = new Set<HTMLElement>(revealEls);

    const syncReveals = () => {
      if (pending.size === 0) return;
      const vh = window.innerHeight;
      for (const el of Array.from(pending)) {
        const r = el.getBoundingClientRect();
        // Visible if any part is within the viewport, minus the 6% bottom
        // margin the original design used to delay the trigger slightly.
        if (r.top < vh * 0.94 && r.bottom > 0) {
          el.classList.add("in");
          pending.delete(el);
        }
      }
    };

    syncReveals();
    // Re-run once after the first paint: at effect time the layout can still be
    // settling (fonts, images, a 0-height viewport during hydration), which
    // would otherwise leave above-the-fold content stuck invisible.
    const firstPaintSync = requestAnimationFrame(syncReveals);
    window.addEventListener("scroll", syncReveals, { passive: true });
    window.addEventListener("resize", syncReveals);
    cleanups.push(() => {
      cancelAnimationFrame(firstPaintSync);
      window.removeEventListener("scroll", syncReveals);
      window.removeEventListener("resize", syncReveals);
    });

    // ── Nav border on scroll ─────────────────────────────────────────
    const nav = root.querySelector<HTMLElement>(".nav");
    const onScrollNav = () => nav?.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScrollNav, { passive: true });
    onScrollNav();
    cleanups.push(() => window.removeEventListener("scroll", onScrollNav));

    // ── Spotlight (cursor-tracked radial) on .spot cards ─────────────
    const spotHandlers: Array<[HTMLElement, (e: PointerEvent) => void]> = [];
    root.querySelectorAll<HTMLElement>(".spot").forEach((card) => {
      const handler = (e: PointerEvent) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${e.clientX - r.left}px`);
        card.style.setProperty("--my", `${e.clientY - r.top}px`);
      };
      card.addEventListener("pointermove", handler);
      spotHandlers.push([card, handler]);
    });
    cleanups.push(() => {
      for (const [card, handler] of spotHandlers) {
        card.removeEventListener("pointermove", handler);
      }
    });

    // ── Apple scroll choreography: device settle + hero parallax ─────
    type TiltItem = {
      el: HTMLElement;
      rx: number; s: number; ty: number; ry: number;
      tgtRx: number; tgtS: number; tgtTy: number; tgtRy: number;
      hero: boolean;
    };

    const tiltItems: TiltItem[] = Array.from(
      root.querySelectorAll<HTMLElement>("[data-tilt]"),
    ).map((el) => ({
      el,
      rx: 14, s: 0.94, ty: 26, ry: 0,
      tgtRx: 14, tgtS: 0.94, tgtTy: 26, tgtRy: 0,
      hero: el.hasAttribute("data-hero"),
    }));

    if (tiltItems.length === 0) return () => cleanups.forEach((c) => c());

    const heroInner = root.querySelector<HTMLElement>(".hero-inner");
    const heroState = { y: 0, o: 1, tgtY: 0, tgtO: 1 };
    let mouseX = 0.5;
    let rafId = 0;

    function updateTargets() {
      const vh = window.innerHeight;
      const sy = window.scrollY;

      for (const it of tiltItems) {
        const r = it.el.getBoundingClientRect();
        if (r.bottom < -160 || r.top > vh + 160) continue;
        const center = r.top + r.height / 2;
        // progress 0 → 1 as the device rises toward the upper-middle of the viewport
        const p = 1 - Math.min(Math.max((center - vh * 0.4) / (vh * 0.62), 0), 1);
        it.tgtRx = (1 - p) * 14;            // rotateX 14° → 0°
        it.tgtS = 0.94 + p * 0.06;          // scale .94 → 1
        it.tgtTy = (1 - p) * 30;            // translateY 30px → 0
        it.tgtRy = it.hero ? (mouseX - 0.5) * 3.5 : 0; // hero leans toward cursor
      }

      if (heroInner) {
        const hp = Math.min(sy / (vh * 0.85), 1);
        heroState.tgtY = sy * 0.3;
        heroState.tgtO = 1 - hp * 0.75;
      }
    }

    function frame() {
      const k = 0.09;
      for (const it of tiltItems) {
        it.rx += (it.tgtRx - it.rx) * k;
        it.s += (it.tgtS - it.s) * k;
        it.ty += (it.tgtTy - it.ty) * k;
        it.ry += (it.tgtRy - it.ry) * (k * 0.7);
        it.el.style.transform =
          `perspective(1200px) rotateX(${it.rx.toFixed(3)}deg) rotateY(${it.ry.toFixed(3)}deg)` +
          ` translateY(${it.ty.toFixed(2)}px) scale(${it.s.toFixed(4)})`;
      }
      if (heroInner) {
        heroState.y += (heroState.tgtY - heroState.y) * 0.12;
        heroState.o += (heroState.tgtO - heroState.o) * 0.12;
        heroInner.style.transform = `translateY(${heroState.y.toFixed(2)}px)`;
        heroInner.style.opacity = heroState.o.toFixed(3);
      }
      rafId = requestAnimationFrame(frame);
    }

    const onPointerMove = (e: PointerEvent) => {
      mouseX = e.clientX / window.innerWidth;
      updateTargets();
    };

    window.addEventListener("scroll", updateTargets, { passive: true });
    window.addEventListener("resize", updateTargets);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    updateTargets();
    rafId = requestAnimationFrame(frame);

    cleanups.push(() => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", updateTargets);
      window.removeEventListener("resize", updateTargets);
      window.removeEventListener("pointermove", onPointerMove);
    });

    return () => cleanups.forEach((c) => c());
  }, [rootRef]);
}
