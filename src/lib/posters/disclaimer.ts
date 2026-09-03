import { POSTER_DISCLAIMER } from "@/lib/posters/theme";
import { combinedDisclaimerNote } from "@/lib/posters/scope";
import type { PosterStats } from "@/lib/posters/poster-data";

/**
 * What a poster has to admit about its own figures.
 *
 * ONE implementation, used by the on-screen preview and by the scheduled
 * render. It was two, and only the preview had it: every poster published
 * automatically to partners went out with the qualifications stripped, on the
 * path with no human in the loop. The reader who most needed them saw them
 * least.
 *
 * Each note exists because a figure above it is narrower than it looks:
 *
 *   Avg R      averages only trades that had a stop, while the poster prints a
 *              total trade count beside it.
 *   Win rate   excludes breakevens, so wins + losses need not equal trades.
 *   By entry   a trade with no recorded close is placed by its entry date, so
 *              a daily poster can contain a trade that closed days later.
 *
 * They are stated on the artefact rather than alongside it because the
 * artefact is what gets forwarded.
 */
export function posterDisclaimer(
  stats: PosterStats | null,
  journalsClaimed: number,
): string {
  if (!stats) return POSTER_DISCLAIMER;

  const notes: string[] = [];

  // A poster carrying two traders' results has to say so ON the image: a
  // reader would otherwise take the figures for one person's record.
  const combined = combinedDisclaimerNote(journalsClaimed);
  if (combined) notes.push(combined);

  if (stats.rCovered > 0 && stats.rCovered < stats.tradeCount) {
    notes.push(
      `Avg R covers the ${stats.rCovered} of ${stats.tradeCount} trades that had a stop loss.`,
    );
  }

  if (stats.breakeven > 0) {
    notes.push(
      `Win rate excludes ${stats.breakeven} breakeven ${
        stats.breakeven === 1 ? "trade" : "trades"
      }, so wins and losses do not sum to the trade count.`,
    );
  }

  // `closeTimeKnown` counts trades bucketed by a REAL close. The rest fell
  // back to entry date, which is the single most likely reason a poster
  // disagrees with someone reading the journal.
  const byEntry = stats.tradeCount - stats.closeTimeKnown;
  if (byEntry > 0) {
    notes.push(
      `${byEntry} ${byEntry === 1 ? "trade" : "trades"} placed by entry date (no close time recorded).`,
    );
  }

  return [...notes, POSTER_DISCLAIMER].join(" ");
}
