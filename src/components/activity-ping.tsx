"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

const KEY = "fxu:last-active-ping";
const HOUR = 60 * 60 * 1000;

/**
 * Records that the user is active, at most once an hour per browser.
 *
 * This used to run server-side in the app layout, which meant one RPC on EVERY
 * navigation — dozens per session, all but the first of which the database
 * threw away (touch_last_active is itself debounced to an hour). Checking a
 * local timestamp first turns that into a single call per hour.
 *
 * localStorage is only a cost optimisation, never a security control: the
 * function still enforces the one-hour window server-side, so a cleared or
 * forged timestamp changes nothing but the number of requests.
 */
export function ActivityPing() {
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < HOUR) return;
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Private mode or storage disabled: fall through and ping. Correctness
      // over thrift.
    }
    void createClient().rpc("touch_last_active");
  }, []);

  return null;
}
