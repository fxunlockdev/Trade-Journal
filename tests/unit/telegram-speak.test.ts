import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mayReplyIn } from "@/lib/telegram/speak";

/**
 * One reply about an expired code, posted in a signal room, was forwarded to
 * every partner group. The rule that stops it is small enough to pin exactly.
 */
describe("where the bot may speak", () => {
  it("answers a person in private", () => {
    expect(mayReplyIn("123456", false)).toBe(true);
  });

  it("speaks in a group or channel only when it is a connected posters destination", () => {
    expect(mayReplyIn("-1003984080453", false)).toBe(false);
    expect(mayReplyIn("-5382225525", false)).toBe(false);
    expect(mayReplyIn("-1004427356211", true)).toBe(true);
  });
});

describe("the webhook", () => {
  it("has exactly one way to send a message, and it asks the rule first", () => {
    const src = readFileSync("src/app/api/telegram/webhook/route.ts", "utf8");
    const direct = src.match(/sendChatMessage\(/g) ?? [];
    expect(direct).toHaveLength(1);
    expect(src).toMatch(/mayReplyIn\(chatId, \(await resolveChat\(admin, chatId\)\) !== null\)/);
  });
});
