/**
 * End the session and leave for the login screen.
 *
 * Shared by the desktop sidebar and the topbar account menu. The phone used to
 * have no way to sign out at all: the only button lived in a surface hidden
 * below `lg`, and the avatar at the top was a decorative span.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    // Full navigation: the (app) layout reads the cookie server-side, so the
    // server must re-render rather than hydrate a shell it can no longer auth.
    window.location.assign("/login");
  }
}
