/**
 * Where the bot may say anything at all.
 *
 * A message in a group is not only seen by that group: the signal rooms are
 * forwarded on to partner groups, so one reply about an expired code reached
 * every IB. The rule is therefore not "be quiet in listened rooms" but the
 * reverse: the bot speaks in a private chat, and in a group or channel only
 * when that chat is a connected posters destination, which is a room the
 * account chose to hear from it. Everywhere else, silence, whatever was
 * posted: a wrong code, a command, a link code, anything.
 *
 * Telegram gives groups, supergroups and channels negative ids and people
 * positive ones, which is a steadier signal than a `type` field that some
 * update shapes omit.
 */
export function mayReplyIn(chatId: string, connectedDestination: boolean): boolean {
  return !chatId.startsWith("-") || connectedDestination;
}
