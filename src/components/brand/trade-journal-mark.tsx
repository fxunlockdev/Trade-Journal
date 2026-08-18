/**
 * The Trade Journal mark.
 *
 * Three ascending bars in the app's own forest-and-lime palette, not the FXU
 * blue: inside the product this is the Trade Journal's identity, and the
 * sidebar it sits in is already deep forest with lime accents.
 *
 * Deliberately three solid shapes and nothing finer. The same artwork is the
 * favicon (see src/app/icon.svg), where anything thinner than these bars turns
 * to mush at 16px. The lime tile is what makes it findable in a tab strip on
 * both light and dark browser chrome, where a dark tile would disappear.
 */
export function TradeJournalMark({
  size = 26,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="tj-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c3f35c" />
          <stop offset="1" stopColor="#6c9e75" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#tj-mark)" />
      <g fill="#0b1a12">
        <rect x="7" y="19" width="4.5" height="7" rx="2.25" />
        <rect x="13.75" y="14" width="4.5" height="12" rx="2.25" />
        <rect x="20.5" y="9" width="4.5" height="17" rx="2.25" />
      </g>
    </svg>
  );
}
