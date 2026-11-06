// Polling state for the staff queue (B1) and the tracking page (C2). DOM-free so tests can load it.
// The next poll starts `interval` ms after the last one ends. A poll over `timeout` ms is a failure.
// A failure keeps the last data and sets `warning`; only the next success clears it.
// fetchOnce(signal) returns the data, or throws. An error with `final: true` (401, 404) stops polling.
export class Poller {
  constructor(fetchOnce, { interval = 2000, timeout = 5000, now = () => new Date() } = {}) {
    Object.assign(this, { fetchOnce, interval, timeout, now });
    this.data = null;
    this.lastSuccess = null;
    this.warning = false;
    this.stopped = false;
    this.stopReason = null;
  }

  async tick() {
    const abort = new AbortController();
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('timeout'));
      }, this.timeout);
    });
    try {
      this.data = await Promise.race([this.fetchOnce(abort.signal), late]);
      this.lastSuccess = this.now();
      this.warning = false;
    } catch (err) {
      if (err?.final) this.stop(err);
      else this.warning = true;
    } finally {
      clearTimeout(timer);
    }
  }

  async start(onChange) {
    while (!this.stopped) {
      await this.tick();
      onChange(this);
      if (this.stopped) break;
      if (!this.kicked) {
        await new Promise((resolve) => {
          this.wake = resolve;
          this.timer = setTimeout(resolve, this.interval);
        });
      }
      this.kicked = false;
    }
  }

  // Poll again now (after the one in flight, if any).
  kick() {
    this.kicked = true;
    clearTimeout(this.timer);
    this.wake?.();
  }

  stop(reason = null) {
    this.stopped = true;
    this.stopReason = reason;
    clearTimeout(this.timer);
    this.wake?.();
  }
}

// For fetchOnce: a response that should end polling (signed out, link not valid).
export const finalError = (status) => Object.assign(new Error(`HTTP ${status}`), { final: true, status });
