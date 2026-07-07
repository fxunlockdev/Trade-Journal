/**
 * Canonical MT5-shaped trade event — the common currency for every ingest
 * source (Myfxbook bridge, report import). Times are unix SECONDS in UTC.
 *
 * A plain type (not a zod schema): events are constructed by our own trusted
 * mappers (`lib/myfxbook/map.ts`, `lib/import/mt5-report.ts`), never parsed
 * from untrusted request bodies, so there is nothing to validate at runtime.
 * Invariant kept by the producers: a `close` event always carries
 * `exit_price`, `close_time` and `profit`.
 */
export interface Mt5Event {
  readonly type: "open" | "update" | "close";
  /** Dedupe key within an account — stable across partial closes. */
  readonly ticket: number;
  readonly symbol: string;
  readonly direction: "buy" | "sell";
  /** Volume in lots. */
  readonly volume: number;
  readonly entry_price: number;
  readonly sl?: number | null;
  readonly tp?: number | null;
  readonly open_time: number;
  /** Close-only fields — cumulative snapshots. */
  readonly exit_price?: number;
  readonly close_time?: number;
  readonly profit?: number;
  readonly commission?: number;
  readonly swap?: number;
  readonly closed_volume?: number;
  /** True once the position no longer exists (fully closed). */
  readonly is_final?: boolean;
}
