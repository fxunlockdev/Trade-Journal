"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  BookOpen,
  Plus,
  MessageSquare,
  Lightbulb,
  Calculator,
  Radio,
  Settings as SettingsIcon,
  Search,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

interface CommandAction {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly icon: React.ElementType;
  readonly href: string;
  readonly keywords?: readonly string[];
  readonly shortcut?: string;
  /** Restrict to roles with publishing privilege. */
  readonly traderOnly?: boolean;
}

const NAV_ACTIONS: readonly CommandAction[] = [
  {
    id: "dashboard",
    label: "Go to Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    keywords: ["home", "overview"],
  },
  {
    id: "journal",
    label: "Go to Journal",
    icon: BookOpen,
    href: "/journal",
    keywords: ["trades", "history", "log"],
  },
  {
    id: "ai-chat",
    label: "AI Trade Chat",
    icon: MessageSquare,
    href: "/ai-chat",
    keywords: ["ai", "gpt", "assistant"],
  },
  {
    id: "insights",
    label: "AI Insights",
    icon: Lightbulb,
    href: "/insights",
    keywords: ["analysis", "review"],
  },
  {
    id: "risk-calc",
    label: "Risk Calculator",
    icon: Calculator,
    href: "/risk-calculator",
    keywords: ["risk", "position", "sizing", "lots"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    href: "/settings",
    keywords: ["profile", "account", "preferences"],
  },
];

const CREATE_ACTIONS: readonly CommandAction[] = [
  {
    id: "new-trade",
    label: "Add Trade",
    hint: "@trade",
    icon: Plus,
    href: "/journal/new",
    keywords: ["new", "log", "create", "trade", "@trade"],
    shortcut: "T",
  },
  {
    id: "new-signal",
    label: "New Signal",
    hint: "@signal",
    icon: Radio,
    href: "/signals/new",
    keywords: ["new", "signal", "create", "publish", "@signal"],
    shortcut: "S",
    traderOnly: true,
  },
];

interface CommandPaletteProps {
  readonly role: string;
}

/**
 * Cmd+K (Ctrl+K on Windows/Linux) opens a fuzzy-search command palette
 * with quick-access actions. Typing "@trade" jumps straight to Add Trade,
 * "@signal" to New Signal (trader/admin only).
 *
 * Mounted once in AppShell so shortcuts are globally available regardless
 * of route. Visibility state is local — nothing to persist between sessions.
 */
export function CommandPalette({ role }: CommandPaletteProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const canPublishSignals = role === "trader" || role === "admin";

  const createActions = useMemo(
    () => CREATE_ACTIONS.filter((a) => !a.traderOnly || canPublishSignals),
    [canPublishSignals],
  );

  useEffect(() => {
    // Listen for Cmd+K / Ctrl+K globally. Guard against triggering while the
    // user is mid-typing in an <input> or <textarea> — modern browsers still
    // fire keydown there, and Cmd+K in Gmail-like apps does NOT steal focus.
    // But here the palette IS the intended action, so we accept it anyway.
    const keyHandler = (e: KeyboardEvent) => {
      const isCmdK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (!isCmdK) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    // Non-keyboard trigger: the Topbar search button dispatches this event
    // so we have one source of truth for palette visibility.
    const openHandler = () => setOpen(true);
    window.addEventListener("keydown", keyHandler);
    window.addEventListener("trdr:open-command-palette", openHandler);
    return () => {
      window.removeEventListener("keydown", keyHandler);
      window.removeEventListener("trdr:open-command-palette", openHandler);
    };
  }, []);

  const runAction = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command Palette"
      description="Jump to any page or add a trade swiftly"
    >
      <CommandInput placeholder="Type a command, page, or @trade…" />
      <CommandList>
        <CommandEmpty>
          <div className="flex flex-col items-center gap-2 py-4 text-muted-foreground">
            <Search className="h-5 w-5 opacity-50" />
            <p className="text-sm">No matching action.</p>
            <p className="text-xs">
              Try &quot;@trade&quot;, &quot;dashboard&quot;, or
              &quot;insights&quot;.
            </p>
          </div>
        </CommandEmpty>

        <CommandGroup heading="Create">
          {createActions.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                value={`${action.label} ${action.hint ?? ""} ${(action.keywords ?? []).join(" ")}`}
                onSelect={() => runAction(action.href)}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{action.label}</span>
                {action.hint && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {action.hint}
                  </span>
                )}
                {action.shortcut && (
                  <CommandShortcut>⌘{action.shortcut}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <CommandItem
                key={action.id}
                value={`${action.label} ${(action.keywords ?? []).join(" ")}`}
                onSelect={() => runAction(action.href)}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{action.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
