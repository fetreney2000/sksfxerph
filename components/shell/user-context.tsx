"use client";

import * as React from "react";
import type { MemberRole } from "@/lib/types";

export interface ShellUser {
  fullName: string;
  role: MemberRole;
}

const UserContext = React.createContext<ShellUser | null>(null);

/**
 * The authenticated user, resolved server-side by `(app)/layout.tsx` from the
 * session cookie and handed down here.
 *
 * Context rather than a `/api/auth/me` fetch on every screen: the layout has
 * already done the work, and a second round trip just to render initials would
 * be a request per navigation for data we already hold.
 */
export function UserProvider({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
}

export function useUser(): ShellUser {
  const ctx = React.useContext(UserContext);
  if (!ctx) {
    // Rendered outside the provider would mean the layout gate was bypassed —
    // fall back rather than crash the tree.
    return { fullName: "", role: "guru_biasa" };
  }
  return ctx;
}

/** "Nurul Aisyah binti Rahim" → "Nurul" (Malayan name order: given name first). */
export function givenName(fullName: string): string {
  return fullName.split(/\s+/)[0] ?? "";
}

export function initialsOf(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}
