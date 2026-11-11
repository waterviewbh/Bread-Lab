// artifacts/sourdough/lib/remoteSessionGuard.ts
//
// An empty local credential store is NOT proof that no authenticated remote session exists. The Supabase client
// persists its own session (persistSession: true) and keeps it alive (autoRefreshToken: true), and its signOut()
// leaves that session in place when the sign-out request fails (auth-js 2.107.0 GoTrueClient._signOut returns the
// error without removing it). So "remote sign-out failed, local credentials cleared, app killed" restarts the app
// looking signed out locally while a remote session is still open.
//
// Before a decision that depends on who is signed in, a remote session with no local sign-in behind it is closed
// and the closing is CONFIRMED by looking again. If that cannot be confirmed, the caller must stop.
import { api } from "./api";

export class OrphanRemoteSessionError extends Error {
  constructor() {
    super("An earlier account session is still open on this device and could not be closed, so nothing was changed. Check your connection and try again.");
    this.name = "OrphanRemoteSessionError";
  }
}

export async function closeOrphanRemoteSession(): Promise<void> {
  try {
    await api.auth.signout();
  } catch {
    /* whether it worked is decided below, by looking, not by what the call said */
  }

  // Success means "no session now", not "the call returned".
  let remaining: unknown = null;
  try {
    const res = await api.auth.getSession();
    if (res?.error) throw res.error;
    remaining = res?.data?.session ?? null;
  } catch {
    throw new OrphanRemoteSessionError();
  }
  if (remaining) throw new OrphanRemoteSessionError();
}
