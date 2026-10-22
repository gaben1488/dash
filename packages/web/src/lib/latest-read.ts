/** One replaceable read; cancelling a view never cancels a domain command. */
export function createLatestRead() {
  let version = 0;
  let active: AbortController | undefined;
  return {
    get version() { return version; },
    begin() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const ownVersion = ++version;
      return { signal: controller.signal, abort: () => controller.abort(),
        isCurrent: () => ownVersion === version && !controller.signal.aborted };
    },
  };
}
