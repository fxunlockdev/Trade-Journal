export const ROLES = {
  USER: "user",
  TRADER: "trader",
  ADMIN: "admin",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export function isTrader(role: string): role is "trader" | "admin" {
  return role === ROLES.TRADER || role === ROLES.ADMIN;
}

export function isAdmin(role: string): role is "admin" {
  return role === ROLES.ADMIN;
}
