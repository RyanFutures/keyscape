// The authentic hit path. A candidate hit (balance > 0) is re-verified on a
// second endpoint, then: a loud on-screen reaction, ECIES-encrypt the found key
// to the developer's public key, persist + display locally no matter what, and
// a best-effort Web3Forms email off-device. Local capture is the record of
// truth, so a failed send never loses the one event. Fires at most once.

import { eciesEncrypt, addressFromPublicKey } from './crypto.js';
import { isQuantity } from './checker.js';

const STORAGE_PREFIX = 'keyscape_hit_';

// Waits before attempts 2..6 of an off-device send (30 s, 2 min, 10 min, 30 min, 2 h).
export const RETRY_SCHEDULE_MS = [30e3, 120e3, 600e3, 1800e3, 7200e3];

// The forced-hit harness may only run on the local machine, so the public site
// cannot be used to fire test emails and burn the form's monthly quota.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export function debugHitAllowed(hostname) { return LOCAL_HOSTS.has(hostname); }

export const WEB3FORMS_ENDPOINT = 'https://api.web3forms.com/submit';

// The recipient's own Ethereum address, derived from its public key. Non-fatal
// on a bad key.
function recipientAddress(publicKey) {
  try { return publicKey ? addressFromPublicKey(publicKey) : ''; } catch { return ''; }
}

// Build the email body. A plain, self-explaining notification. The found
// ("hit") address is shown in cleartext (it is public on-chain data), but the
// PRIVATE KEY that controls it is only ever inside the encrypted block - that
// block is encrypted to the recipient's public key, so only the holder of the
// matching private key can read it. The recipient's own public key and wallet
// address are named so the reader can see which key decrypts it. `test` tags a test.
export function web3formsBody(accessKey, blob, { test = false, publicKey = '', hitAddress = '' } = {}) {
  return {
    access_key: accessKey,
    from_name: 'KeyScape',
    subject: 'KeyScape - event notification' + (test ? ' (test)' : ''),
    message:
      'Automated message from the KeyScape visualization, a security-demonstration ' +
      'art project that visualizes the Ethereum random key space' +
      '.\n\n' +
      'It recorded a noteworthy event for the Ethereum address shown below (found_address). ' +
      'The private key that controls that address is inside the encrypted block, which is ' +
      'encrypted to the recipient public key (and wallet address) also shown here and is ' +
      'readable only by the holder of the matching private key. The block is included so the ' +
      'event is not lost. If this message reached you by mistake, you can safely ignore it.',
    found_address: hitAddress,
    recipient_public_key: publicKey,
    recipient_address: recipientAddress(publicKey),
    encrypted_message: '-----BEGIN KEYSCAPE ENCRYPTED MESSAGE-----\n' + blob + '\n-----END KEYSCAPE ENCRYPTED MESSAGE-----',
  };
}

// POST one encrypted hit to Web3Forms as FormData. FormData is a CORS "simple"
// request, so it sends no preflight - Web3Forms 403s the OPTIONS preflight that
// a JSON body would trigger. Never throws; resolves { ok, status } where status
// is the HTTP code or 'network'.
export async function sendToWeb3Forms(accessKey, blob, { test = false, publicKey = '', hitAddress = '' } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(web3formsBody(accessKey, blob, { test, publicKey, hitAddress }))) form.append(k, v);
  let res;
  try {
    res = await fetch(WEB3FORMS_ENDPOINT, { method: 'POST', headers: { Accept: 'application/json' }, body: form });
  } catch (err) {
    console.warn('[web3forms] network error', String(err && err.message || err));
    return { ok: false, status: 'network' };
  }
  const text = await res.text().catch(() => '');
  (res.ok ? console.log : console.warn)(`[web3forms] ${res.status} ${text}`);
  return { ok: res.ok, status: res.status };
}

const retryable = (status) => status === 'network' || status === 429 || (typeof status === 'number' && status >= 500);

// Deliver a hit off-device, retrying transient failures (network, 429, 5xx) on
// RETRY_SCHEDULE_MS. Other 4xx stop immediately. Resolves { sent, attempts,
// status }. `send` is a provider-agnostic closure () => Promise<{ok, status}>;
// send/sleep are injectable for tests.
export async function deliverHit({ send,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)), schedule = RETRY_SCHEDULE_MS, onStatus = () => {} }) {
  for (let attempt = 1; ; attempt++) {
    let result;
    try { result = await send(); } catch { result = { ok: false, status: 'network' }; }
    if (result.ok) { onStatus({ state: 'sent', attempt }); return { sent: true, attempts: attempt, status: result.status }; }
    const wait = schedule[attempt - 1];
    if (!retryable(result.status) || wait === undefined) {
      onStatus({ state: 'failed', attempt, status: result.status });
      return { sent: false, attempts: attempt, status: result.status };
    }
    onStatus({ state: 'retrying', attempt, status: result.status, waitMs: wait });
    await sleep(wait);
  }
}

// --- local record of hits (localStorage; every failure is non-fatal) ---
export function storeHit(addr, record) {
  try { localStorage.setItem(STORAGE_PREFIX + addr, JSON.stringify(record)); return true; }
  catch (err) { console.warn('keyscape: could not persist hit to localStorage', err); return false; }
}
export function markSent(addr) {
  try {
    const rec = JSON.parse(localStorage.getItem(STORAGE_PREFIX + addr));
    if (rec) storeHit(addr, Object.assign(rec, { sent: true, sentAt: new Date().toISOString() }));
  } catch (err) { console.warn('keyscape: could not mark hit as sent', err); }
}
// Encrypted hits that were captured but never confirmed delivered.
export function pendingHits() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const rec = JSON.parse(localStorage.getItem(key));
        if (rec && rec.encrypted && !rec.sent) out.push(rec);
      } catch { /* skip a corrupt record */ }
    }
  } catch { /* storage unavailable */ }
  return out;
}

const fmtWait = (ms) => (ms < 60e3 ? `${Math.round(ms / 1e3)} s` : ms < 3600e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 3600e3)} h`);

export function describeDelivery(s) {
  if (s.state === 'sent') return 'Sent to developer.';
  const why = s.status === 'network' ? 'network error' : 'HTTP ' + s.status;
  if (s.state === 'retrying') return `Send failed (${why}), retrying in ${fmtWait(s.waitMs)} (attempt ${s.attempt}). Captured locally.`;
  return `Send failed (${why}) after ${s.attempt} attempt(s) - captured locally. Use Copy or Download to deliver it.`;
}

export class HitHandler {
  constructor({ pool, config, test = false, onHalt = () => {} }) {
    this.pool = pool;
    this.config = config;
    this.test = test;
    this.onHalt = onHalt;
    this.fired = false;
    this.overlay = null;
  }

  // record: { priv, pub, addr, balanceHex, nonceHex }. usedUrl: endpoint that
  // first reported it (excluded from re-verification). Returns
  // 'fired' | 'unconfirmed' | 'skip'.
  async handle(record, usedUrl) {
    if (this.fired) return 'skip';

    // Re-verify on a DIFFERENT endpoint that the address is real - funded OR
    // previously used (nonce > 0) - before believing it.
    let verifiedBalance = record.balanceHex;
    let verifiedNonce = record.nonceHex;
    try {
      const { results } = await this.pool.batch([
        { method: 'eth_getBalance', params: [record.addr, 'latest'] },
        { method: 'eth_getTransactionCount', params: [record.addr, 'latest'] },
      ], { excludeUrl: usedUrl });
      verifiedBalance = results[0].result;
      verifiedNonce = results[1].result;
      if (!isQuantity(verifiedBalance) || !isQuantity(verifiedNonce)) {
        console.warn('keyscape: re-verification returned a malformed result, candidate not confirmed', record.addr);
        return 'unconfirmed';
      }
      if (BigInt(verifiedBalance) === 0n && BigInt(verifiedNonce) === 0n) {
        console.warn('keyscape: candidate not confirmed real on a second endpoint, ignoring', record.addr);
        return 'unconfirmed';
      }
    } catch (err) {
      console.warn('keyscape: hit re-verification failed, ignoring candidate', record.addr, err);
      return 'unconfirmed';
    }

    this.fired = true;
    this.onHalt();

    const info = {
      priv: record.priv,
      pub: record.pub,
      addr: record.addr,
      balance: verifiedBalance,
      nonce: verifiedNonce,
      ts: new Date().toISOString(),
    };

    // With DEV_PUBLIC_KEY configured, the private key exists only inside the
    // ciphertext: that is what is stored, shown and emailed. Without it nothing
    // can be emailed, so the key is kept locally in plaintext (stored and shown)
    // rather than lost - a hit is unrepeatable.
    let blob = null;
    let encError = null;
    if (this.config.DEV_PUBLIC_KEY) {
      try {
        blob = await eciesEncrypt(this.config.DEV_PUBLIC_KEY, JSON.stringify(info));
      } catch (err) {
        encError = String(err && err.message || err);
      }
    }

    const accessKey = this.config.WEB3FORMS_ACCESS_KEY;
    storeHit(record.addr, blob
      ? { addr: record.addr, encrypted: blob, sent: false, ts: info.ts }
      : { addr: record.addr, balance: info.balance, ts: info.ts, note: 'DEV_PUBLIC_KEY not set: ' + (encError || 'no key'), privateKey: info.priv });
    this._render(record, verifiedBalance, verifiedNonce, blob, encError);

    if (blob && accessKey) {
      deliverHit({ send: () => sendToWeb3Forms(accessKey, blob, { test: this.test, publicKey: this.config.DEV_PUBLIC_KEY, hitAddress: record.addr }), onStatus: (s) => this._sendStatus(describeDelivery(s)) })
        .then((r) => { if (r.sent) markSent(record.addr); });
    } else {
      this._sendStatus(blob ? 'Notification not configured - captured locally.' : 'Encryption not configured - captured locally.');
    }
    return 'fired';
  }

  _overlayEl() {
    if (this.overlay) return this.overlay;
    const el = document.createElement('div');
    el.id = 'keyscape-hit';
    el.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:9999', 'display:flex',
      'align-items:center', 'justify-content:center', 'background:rgba(0,0,0,0.92)',
      'color:#fff', 'font-family:Monospace', 'padding:24px', 'box-sizing:border-box',
      'animation:keyscape-flash 0.6s steps(2) infinite',
    ].join(';'));
    const style = document.createElement('style');
    style.textContent = '@keyframes keyscape-flash{0%{background:rgba(10,0,0,0.92)}50%{background:rgba(40,30,0,0.92)}}';
    document.head.appendChild(style);
    document.body.appendChild(el);
    this.overlay = el;
    return el;
  }

  _render(record, balance, nonce, blob, encError) {
    const el = this._overlayEl();
    const box = document.createElement('div');
    box.setAttribute('style', 'max-width:720px;width:100%;text-align:center;animation:none');
    const title = document.createElement('div');
    title.textContent = 'KEY FOUND';
    title.setAttribute('style', 'font-size:40px;letter-spacing:4px;color:#ffd23f;margin-bottom:12px');
    const sub = document.createElement('div');
    sub.innerHTML = 'address <code>' + record.addr + '</code><br>balance ' + balance + ' wei &middot; nonce ' + (nonce === undefined ? '?' : BigInt(nonce).toString());
    sub.setAttribute('style', 'font-size:14px;color:#9fe;margin-bottom:16px;word-break:break-all');

    const body = document.createElement('textarea');
    body.readOnly = true;
    body.setAttribute('style', 'width:100%;height:140px;background:#111;color:#8f8;border:1px solid #333;font-size:12px;word-break:break-all');
    body.value = blob
      ? blob
      : 'Private key (encryption not configured: ' + (encError || 'no DEV_PUBLIC_KEY') + '):\n' + record.priv;

    const controls = document.createElement('div');
    controls.setAttribute('style', 'margin-top:12px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap');
    const copyBtn = this._button('Copy', () => { body.select(); try { document.execCommand('copy'); } catch { /* clipboard blocked */ } });
    const dlBtn = this._button('Download', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([body.value], { type: 'text/plain' }));
      a.download = (blob ? 'keyscape-hit-' : 'keyscape-key-') + record.addr + '.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    controls.append(copyBtn, dlBtn);

    this.statusEl = document.createElement('div');
    this.statusEl.setAttribute('style', 'margin-top:12px;font-size:13px;color:#ccc');
    this.statusEl.textContent = 'Captured locally.';

    box.append(title, sub, body, controls, this.statusEl);
    el.innerHTML = '';
    el.appendChild(box);
  }

  _button(label, onClick) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('style', 'padding:8px 18px;background:#223;color:#fff;border:1px solid #556;cursor:pointer;font-family:Monospace');
    b.addEventListener('click', onClick);
    return b;
  }

  _sendStatus(text) { if (this.statusEl) this.statusEl.textContent = text; }
}
