/**
 * UpdateCoordinator: keeps one observed target (staff queue/detail or a private tracking snapshot) current
 * by polling. Records only successful checks, keeps the last information when a refresh fails (timeouts
 * count as failures), clears the stale flag only after a successful refresh, and ignores responses older
 * than one already applied or belonging to a previous target. It only reads; it never repeats a write.
 *
 * load(target, timeoutMs) resolves { kind: 'ok', data } or { kind: 'end', ... } (access lost, link or order
 * unavailable: polling stops) and rejects for connection/service failures.
 */
export function createUpdateCoordinator({ load, onSuccess, onFailure, onEnd, intervalMs, timeoutMs = 8000 }) {
  let target = null;
  let generation = 0;
  let sequence = 0;
  let appliedSequence = 0;
  let timer = null;

  const state = { lastSuccessfulCheck: null, currentInformation: null, stale: false };

  function schedule() {
    clearTimeout(timer);
    if (target !== null) timer = setTimeout(refresh, intervalMs);
  }

  async function refresh() {
    if (target === null) return;
    const requestGeneration = generation;
    const requestSequence = ++sequence;
    const requestTarget = target;
    clearTimeout(timer);

    let outcome;
    try {
      outcome = await load(requestTarget, timeoutMs);
    } catch {
      outcome = { kind: 'failure' };
    }
    if (requestGeneration !== generation || requestSequence < appliedSequence) return;
    appliedSequence = requestSequence;

    if (outcome.kind === 'ok') {
      state.lastSuccessfulCheck = new Date();
      state.currentInformation = outcome.data;
      state.stale = false;
      onSuccess(outcome.data, state, requestTarget);
    } else if (outcome.kind === 'end') {
      stop();
      onEnd(outcome, requestTarget);
      return;
    } else {
      state.stale = true;
      onFailure(state, requestTarget);
    }
    schedule();
  }

  function stop() {
    generation += 1;
    target = null;
    clearTimeout(timer);
  }

  window.addEventListener('online', () => {
    if (target !== null && state.stale) refresh();
  });

  return {
    state,
    /** Starts observing a new target; earlier information belongs to the old target and is discarded. */
    observe(newTarget) {
      stop();
      target = newTarget;
      state.lastSuccessfulCheck = null;
      state.currentInformation = null;
      state.stale = false;
      return refresh();
    },
    refresh,
    /** Recovery is just a refresh: the stale warning clears only if it succeeds. */
    recover: refresh,
    stop,
    get target() {
      return target;
    },
  };
}
