// Renderer-side cache of live formula data. get() answers from the cache and
// fetches in the background; when an answer arrives, onChange() recalculates.

const TTL = { quote: 60_000, history: 3_600_000, text: 3_600_000, range: 300_000, translate: 86_400_000 };
const RETRY = 120_000;

export function createWeb(fetcher, onChange) {
  const cache = new Map();
  let timer = 0;
  let used = false;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 150);
  };

  function load(key, kind, params, entry) {
    entry.loading = true;
    Promise.resolve(fetcher(kind, params)).then((r) => {
      if (r && 'value' in r && !r.error) Object.assign(entry, { value: r.value, error: null, at: Date.now() });
      else Object.assign(entry, { error: r?.error || 'The data couldn\'t be loaded.', at: Date.now() });
    }, (err) => {
      Object.assign(entry, { error: String(err?.message || err), at: Date.now() });
    }).finally(() => {
      entry.loading = false;
      changed();
    });
  }

  return {
    // { value } | { error } | undefined while the first answer is loading. Stale values are served while refreshing.
    get(kind, params) {
      used = true;
      const key = `${kind}:${JSON.stringify(params)}`;
      let entry = cache.get(key);
      if (!entry) {
        entry = { loading: false, at: 0 };
        cache.set(key, entry);
        load(key, kind, params, entry);
        return undefined;
      }
      const age = Date.now() - entry.at;
      if (!entry.loading && entry.at && age > (entry.error ? RETRY : TTL[kind] || 60_000)) load(key, kind, params, entry);
      if ('value' in entry && entry.value !== undefined) return { value: entry.value };
      if (entry.error) return { error: entry.error };
      return undefined;
    },
    // True when a formula asked for live data since the last call.
    takeUsed() {
      const u = used;
      used = false;
      return u;
    },
  };
}
