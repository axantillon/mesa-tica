import { request } from './common.js';

// One reader per view. Stopping aborts it and prevents late responses from reaching a new view.
export function observe(path, { success, failure }, interval = 2000) {
  const controller = new AbortController();
  let timer;
  async function refresh() {
    let keepWatching;
    try {
      const snapshot = await request(path, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      keepWatching = success(snapshot, new Date());
    } catch (error) {
      if (controller.signal.aborted) return;
      keepWatching = failure(error);
    }
    if (keepWatching !== false && !controller.signal.aborted) timer = setTimeout(refresh, interval);
  }
  void refresh();
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}
