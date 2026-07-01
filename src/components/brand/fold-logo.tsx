import { cn } from "@/lib/utils";

interface FoldLogoProps {
  /** Pixel size of the square glyph. */
  size?: number;
  className?: string;
}

/**
 * The Fold — TradLabs' origami-arrow brand mark. An arrow folded from a single
 * sheet: two planes lifting from a central spine, grounded by a shadow plane.
 * Mint + lime catch the light; deep forest anchors it. Purely decorative.
 */
export function FoldLogo({ size = 30, className }: FoldLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <polygon points="18,62 48,46 78,62 48,76" fill="#0f3218" />
      <polygon points="48,14 18,62 48,46" fill="#c4edc6" />
      <polygon points="48,14 78,62 48,46" fill="#a8d642" />
    </svg>
  );
}

interface FoldWordmarkProps {
  /** Product name — bold first word, lighter second word. */
  className?: string;
  glyphSize?: number;
}

/**
 * Horizontal lockup: Fold glyph + "FX Unlock" wordmark. Inherits text color so
 * it reads correctly on both the light canvas and dark forest surfaces.
 */
export function FoldWordmark({ className, glyphSize = 26 }: FoldWordmarkProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <FoldLogo size={glyphSize} />
      <span className="font-heading text-lg tracking-tight">
        <b className="font-extrabold">FX</b>
        <span className="font-medium opacity-90"> Unlock</span>
      </span>
    </span>
  );
}
