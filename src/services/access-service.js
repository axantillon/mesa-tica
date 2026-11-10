const WINDOW_MS = 10 * 60_000;
const MAX_FAILURES_PER_USERNAME = 5;
const MAX_FAILURES_PER_ADDRESS = 30;

/**
 * AccessService: staff sign-in, per-request authorization and sign-out. Failed sign-ins are limited per
 * username and per client address; the limit applies identically to unknown usernames, so neither the
 * response nor the limit reveals whether an account exists. Password hashing runs on the libuv thread
 * pool, so guest ordering stays responsive during sign-in checks.
 */
export function createAccessService({ identityStore, sessionTtlMinutes, now = () => new Date() }) {
  // ponytail: in-memory limiter per process; move to shared storage if several app processes serve staff.
  const failures = new Map();

  function activeFailures(key, at) {
    const entry = failures.get(key);
    if (!entry || entry.resetAt <= at) {
      failures.delete(key);
      return null;
    }
    return entry;
  }

  function limitedFor(keys, at) {
    const limits = { user: MAX_FAILURES_PER_USERNAME, addr: MAX_FAILURES_PER_ADDRESS };
    for (const key of keys) {
      const entry = activeFailures(key, at);
      if (entry && entry.count >= limits[key.split(':')[0]]) return Math.ceil((entry.resetAt - at) / 1000);
    }
    return 0;
  }

  function recordFailure(keys, at) {
    // Drop expired entries once the map grows, so guessed usernames cannot grow memory without bound.
    if (failures.size > 10_000) for (const key of failures.keys()) activeFailures(key, at);
    for (const key of keys) {
      const entry = activeFailures(key, at) ?? { count: 0, resetAt: at + WINDOW_MS };
      entry.count += 1;
      failures.set(key, entry);
    }
  }

  return {
    async signIn(credentials, remoteAddress) {
      const at = now().getTime();
      const userKey = `user:${credentials.username.trim().toLowerCase()}`;
      const keys = [userKey, `addr:${remoteAddress ?? 'unknown'}`];
      const retryAfterSeconds = limitedFor(keys, at);
      if (retryAfterSeconds > 0) return { result: 'limited', retryAfterSeconds };

      const session = await identityStore.authenticate(credentials, { now: now(), ttlMinutes: sessionTtlMinutes });
      if (!session) {
        recordFailure(keys, at);
        return { result: 'failed' };
      }
      failures.delete(userKey);
      return { result: 'signed_in', ...session };
    },

    /** Current authorized employee for a session token, or null. Every staff read and write calls this. */
    requireStaff(token) {
      return identityStore.resolveAccess(token, now());
    },

    signOut(token) {
      identityStore.revokeAccess(token);
    },
  };
}
