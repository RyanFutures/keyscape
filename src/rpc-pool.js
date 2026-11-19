// A pool of keyless JSON-RPC endpoints with round-robin, call-based pacing,
// per-endpoint batch limits, failover, and exponential backoff. This is the one
// external dependency the demonstration cannot avoid, so any single endpoint
// dying or tightening its limits must not stop it - or need a code change.
//
// Free public endpoints limit per IP, and most count every call inside a batch:
//   - pacing: after sending N calls to an endpoint, wait N x perCallMs (at least
//     minIntervalMs) before using it again;
//   - batch limits: an endpoint is only offered batches it can take. Limits can
//     be seeded in config ({ url, maxCalls }) and are LEARNED when an endpoint
//     rejects a batch with HTTP 400 (halved, floor 2 = one key's calls);
//   - 429s (or JSON-RPC rate-limit errors) cool an endpoint longer than other
//     errors, and failures DECAY one step per success instead of resetting, so
//     an endpoint that throttles routinely stays cooled and carries less load.

const BASE_BACKOFF_MS = 800;
const RATE_LIMIT_BACKOFF_MS = 3000;
const MIN_LEARNED_CALLS = 2;

export class RpcPool {
  constructor(endpoints, { timeoutMs = 12000, maxBackoffMs = 30000, minIntervalMs = 250, perCallMs = 50 } = {}) {
    if (!endpoints || !endpoints.length) throw new Error('RpcPool needs at least one endpoint');
    this.timeoutMs = timeoutMs;
    this.maxBackoffMs = maxBackoffMs;
    this.minIntervalMs = minIntervalMs;
    this.perCallMs = perCallMs;
    this.endpoints = endpoints.map((e) => {
      const cfg = typeof e === 'string' ? { url: e } : e;
      return { url: cfg.url, maxCalls: cfg.maxCalls || Infinity, cooldownUntil: 0, fails: 0, lastUsed: 0, lastCalls: 0 };
    });
    this.cursor = 0;
    // Test hook: set to a function (url) => boolean to force an endpoint to fail.
    this.injectFailure = null;
  }

  // Earliest time this endpoint may be used again (backoff or call pacing).
  _readyAt(ep) {
    return Math.max(ep.cooldownUntil, ep.lastUsed + Math.max(this.minIntervalMs, ep.lastCalls * this.perCallMs));
  }

  _markOk(ep) { ep.fails = Math.max(0, ep.fails - 1); ep.cooldownUntil = 0; }
  _markFail(ep, status) {
    ep.fails += 1;
    const base = status === 429 ? RATE_LIMIT_BACKOFF_MS : BASE_BACKOFF_MS;
    ep.cooldownUntil = Date.now() + Math.min(this.maxBackoffMs, base * 2 ** (ep.fails - 1));
  }

  // Next endpoint that can take `size` calls: round-robin over ready ones,
  // avoiding excludeUrl while another eligible endpoint remains. If none is
  // ready, the soonest-ready and how long to wait. null if none can take `size`.
  _next(size, excludeUrl = null) {
    const n = this.endpoints.length;
    const now = Date.now();
    const eligible = this.endpoints.filter((e) => e.maxCalls >= size);
    if (!eligible.length) return null;
    const canExclude = excludeUrl && eligible.some((e) => e.url !== excludeUrl);
    for (let k = 0; k < n; k++) {
      const ep = this.endpoints[(this.cursor + k) % n];
      if (ep.maxCalls < size) continue;
      if (this._readyAt(ep) <= now && !(canExclude && ep.url === excludeUrl)) {
        this.cursor = (this.cursor + k + 1) % n;
        return { ep, waitMs: 0 };
      }
    }
    const pool = canExclude ? eligible.filter((e) => e.url !== excludeUrl) : eligible;
    let soonest = pool[0];
    for (const ep of pool) if (this._readyAt(ep) < this._readyAt(soonest)) soonest = ep;
    return { ep: soonest, waitMs: Math.max(0, this._readyAt(soonest) - now) };
  }

  async _post(url, body) {
    if (this.injectFailure && this.injectFailure(url)) {
      const e = new Error('injected failure'); e.retryable = true; throw e;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res, text;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      text = await res.text();
    } catch (err) {
      if (err.name === 'AbortError' || err instanceof TypeError) err.retryable = true; // timeout / network / CORS failure
      throw err;
    } finally {
      clearTimeout(timer);
    }

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    if (res.status === 429 || res.status >= 500) {
      const e = new Error('HTTP ' + res.status); e.retryable = true; e.status = res.status; throw e;
    }
    if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    if (typeof parsed === 'string') {
      throw Object.assign(new Error('non-JSON reply'), { retryable: true });
    }
    return parsed;
  }

  // Run a JSON-RPC batch. `calls` is [{ method, params }, ...]. Returns
  // { url, results } where results[i] is { result } or { error } aligned to
  // calls[i]. Tries endpoints until one answers; backs off failed ones.
  async batch(calls, { excludeUrl = null } = {}) {
    const size = calls.length;
    const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }));
    const tries = this.endpoints.length + 1;
    let lastErr;
    for (let attempt = 0; attempt < tries; attempt++) {
      // Prefer a different endpoint (hit re-verify), but relax on the final
      // attempts so a genuine hit still confirms when only the original is up.
      const softExclude = attempt < this.endpoints.length - 1 ? excludeUrl : null;
      const pick = this._next(size, softExclude);
      if (!pick) {
        throw Object.assign(new Error(`batch of ${size} calls exceeds every endpoint's limit`), { tooLarge: true });
      }
      const { ep, waitMs } = pick;
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
      ep.lastUsed = Date.now();
      ep.lastCalls = size;
      try {
        const json = await this._post(ep.url, body);
        if (!Array.isArray(json)) {
          // Some endpoints rate-limit with HTTP 200 and a JSON-RPC error object.
          const msg = (json && json.error && json.error.message) || 'non-array batch reply';
          const code = json && json.error && json.error.code;
          const limited = code === -32005 || code === -32029 || /rate limit|too many/i.test(msg);
          throw Object.assign(new Error(msg), { retryable: true, status: limited ? 429 : undefined });
        }
        const results = new Array(size);
        for (const item of json) results[item.id] = ('error' in item && item.error) ? { error: item.error } : { result: item.result };
        for (let i = 0; i < size; i++) if (!results[i]) results[i] = { error: { message: 'missing' } };
        this._markOk(ep);
        return { url: ep.url, results };
      } catch (err) {
        lastErr = err;
        if (err.status === 400 && size > MIN_LEARNED_CALLS) {
          // A batch other endpoints accept, rejected here: learn its batch limit
          // so it is only offered batches it can take. Not a health failure.
          ep.maxCalls = Math.max(MIN_LEARNED_CALLS, Math.min(ep.maxCalls, Math.floor(size / 2)));
          continue;
        }
        this._markFail(ep, err.status);
        if (!err.retryable && attempt >= this.endpoints.length - 1) break;
      }
    }
    throw lastErr || new Error('all endpoints failed');
  }

  // Single call, optionally on an endpoint other than excludeUrl (hit re-verify).
  async single(method, params, excludeUrl = null) {
    const { results, url } = await this.batch([{ method, params }], { excludeUrl });
    if (results[0].error) throw new Error(results[0].error.message || 'rpc error');
    return { result: results[0].result, url };
  }
}
