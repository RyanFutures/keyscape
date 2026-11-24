// Engine wiring: key-worker -> queue -> batch checker -> checked-key list ->
// visualization, with the hit path and a forced-hit harness. The render loop
// runs independently of checking, so network latency never stalls the animation.

import * as config from './config.js';
import { Viz } from './viz.js';
import { getTheme, THEME_IDS } from './themes.js';
import { initialThemeId, buildThemeSwitcher, saveTheme } from './theme-switcher.js';
import { RpcPool } from './rpc-pool.js';
import { Checker, isHit } from './checker.js';
import { HitHandler, debugHitAllowed, deliverHit, markSent, pendingHits, sendToWeb3Forms } from './hit.js';
import { randomKeypair } from './crypto.js';

// The forced hit (?debughit) injects this REAL keychain: Hardhat/Anvil account
// #0, whose private key is public knowledge. Its address has transacted on
// mainnet (nonce > 0, balance 0), so it is a genuine "real address" hit - the
// re-verification passes truthfully, no faking.
const DEBUG_KEYCHAIN = {
  priv: 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  pub: '048318535b54105d4a7aae60c08fc45f9687181b4fdfc625bd1a753fa7397fed753547f11ca8696646f2f3acb08e31016afac23e630c5d11f59f61fef57b0d2aa5',
  addr: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

const params = new URLSearchParams(location.search);
// Force the full hit chain once - local machine only, so the public site can't
// be used to fire test emails.
const DEBUG_HIT = params.has('debughit') && debugHitAllowed(location.hostname);
if (params.has('debughit') && !DEBUG_HIT) console.warn('keyscape: ?debughit is only honored on localhost; ignored on', location.hostname);
const FAIL_RPC = params.get('failrpc');          // 'all' or a URL substring to force-fail

if (!config.DEV_PUBLIC_KEY || !config.WEB3FORMS_ACCESS_KEY) {
  console.warn('keyscape: hit notification not configured (DEV_PUBLIC_KEY or WEB3FORMS_ACCESS_KEY is empty) - a hit would be captured on this device only');
}

// Re-send any hit that was captured earlier but never confirmed delivered
// (page reloaded, browser restarted, or every retry failed).
if (config.WEB3FORMS_ACCESS_KEY) {
  for (const rec of pendingHits()) {
    console.warn('keyscape: re-sending an undelivered hit for', rec.addr);
    deliverHit({ send: () => sendToWeb3Forms(config.WEB3FORMS_ACCESS_KEY, rec.encrypted, { publicKey: config.DEV_PUBLIC_KEY, hitAddress: rec.addr }),
      onStatus: (s) => console.log('keyscape: re-send', rec.addr, s.state, s.status || '') })
      .then((r) => { if (r.sent) markSent(rec.addr); });
  }
}

const info = document.getElementById('info');
const counterEl = document.getElementById('counter');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let checkedCount = 0;
let hitHalted = false;
const queue = [];

// --- key worker ---
const worker = new Worker(new URL('./key-worker.js', import.meta.url), { type: 'module' });
let reqId = 0;
const pending = new Map();
let workerReadyResolve, workerReadyReject;
const workerReady = new Promise((res, rej) => { workerReadyResolve = res; workerReadyReject = rej; });

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready') workerReadyResolve();
  else if (m.type === 'keys') { const p = pending.get(m.reqId); if (p) { pending.delete(m.reqId); p.resolve(m.keys); } }
  else if (m.type === 'error') { const err = new Error(m.message); workerReadyReject(err); for (const p of pending.values()) p.reject(err); pending.clear(); }
};
worker.onerror = (e) => workerReadyReject(new Error('key worker failed: ' + (e.message || 'could not load')));

function requestKeys(n) {
  return new Promise((resolve, reject) => { const id = ++reqId; pending.set(id, { resolve, reject }); worker.postMessage({ type: 'make', n, reqId: id }); });
}

// --- pool / checker / hit ---
const pool = new RpcPool(config.RPC_ENDPOINTS, {
  timeoutMs: config.RPC_TIMEOUT_MS,
  maxBackoffMs: config.RPC_MAX_BACKOFF_MS,
  minIntervalMs: config.RPC_MIN_INTERVAL_MS,
  perCallMs: config.RPC_PER_CALL_MS,
});
if (FAIL_RPC) pool.injectFailure = (u) => FAIL_RPC === 'all' || u.includes(FAIL_RPC);
const checker = new Checker(pool, { batchKeys: config.BATCH_KEYS, minBatchKeys: config.MIN_BATCH_KEYS, maxBatchKeys: config.MAX_BATCH_KEYS });

// Forced-hit mode exercises the whole chain end to end. Fill in a throwaway
// recipient and/or a placeholder access key if they are not configured, so
// encrypt + send run even before the real values are set. (localhost only.)
let hitConfig = config;
if (DEBUG_HIT) {
  const overrides = {};
  if (!config.DEV_PUBLIC_KEY) {
    const kp = randomKeypair();
    overrides.DEV_PUBLIC_KEY = kp.pub;
    console.log('keyscape debughit: throwaway recipient pub', kp.pub, 'priv', kp.priv);
  }
  if (!config.WEB3FORMS_ACCESS_KEY) {
    overrides.WEB3FORMS_ACCESS_KEY = 'debughit-placeholder-key';
    console.log('keyscape debughit: no WEB3FORMS_ACCESS_KEY set; a real send would be rejected until one is configured');
  }
  if (Object.keys(overrides).length) hitConfig = Object.assign({}, config, overrides);
}
const hit = new HitHandler({ pool, config: hitConfig, test: DEBUG_HIT, onHalt: () => { hitHalted = true; } });

// --- visualization (runs regardless of the engine) ---
const themeId = initialThemeId(config.DEFAULT_THEME);
const rainParam = new URLSearchParams(location.search).get('rain');
const keyOrientation = (rainParam === 'vertical' || rainParam === 'horizontal') ? rainParam : config.KEY_RAIN_ORIENTATION;
const viz = new Viz(document.getElementById('scene'), {
  theme: getTheme(themeId),
  levels: config.HILBERT_LEVELS,
  maxConnections: config.MAX_CONNECTIONS,
  showText: true,
  fontUrl: './vendor/optimer_regular.typeface.json',
  keyOrientation,
});
// Lighting (theme) auto-cycles every 90 s; double-click anywhere locks it to the
// current mode (double-click again resumes cycling). Manual swatch clicks set the
// mode and keep cycling from there.
const CYCLE_MS = (parseInt(new URLSearchParams(location.search).get('cycle'), 10) || 90) * 1000; // seconds; default 90
let themeIndex = Math.max(0, THEME_IDS.indexOf(themeId));
let themeLocked = false;
let cycleTimer = null;
const switcher = buildThemeSwitcher(themeId, (theme) => { themeIndex = Math.max(0, THEME_IDS.indexOf(theme.id)); viz.applyTheme(theme); scheduleCycle(); });

function showTheme(id) { themeIndex = Math.max(0, THEME_IDS.indexOf(id)); viz.applyTheme(getTheme(id)); switcher.setActive(id); }
function scheduleCycle() {
  clearTimeout(cycleTimer);
  if (themeLocked) return;
  cycleTimer = setTimeout(() => { showTheme(THEME_IDS[(themeIndex + 1) % THEME_IDS.length]); scheduleCycle(); }, CYCLE_MS);
}
scheduleCycle();
window.addEventListener('dblclick', () => {
  themeLocked = !themeLocked;
  if (themeLocked) saveTheme(THEME_IDS[themeIndex]);
  scheduleCycle();
  toast(themeLocked ? 'lighting locked' : 'auto-cycling');
});

// Brief centred status message that fades out (lock/unlock feedback).
let toastEl, toastTimer;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

(function animate() { requestAnimationFrame(animate); viz.update(); })();

// One line per checked key: private key -> address, and what the chain said.
// A plain string (not an object), so Chrome's 1,000-message console buffer
// stays small on long runs.
function logKey(rec, url) {
  if (!config.LOG_CHECKED_KEYS) return;
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  const line = `[key] ${rec.priv} -> ${rec.addr}  balance ${BigInt(rec.balanceHex)} wei  nonce ${BigInt(rec.nonceHex)}  ${rec.status.toUpperCase()}  (${host})`;
  (isHit(rec.status) ? console.warn : console.log)(line);
}

// Uptime since this page started (grows to days/weeks on a wall display).
const bootT = Date.now();
function fmtUptime(ms) {
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const hms = [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  return (d > 0 ? d + 'd ' : '') + hms;
}

// Right-hand readout: keys checked, real found, uptime (next to it), key space.
function updateCounter() {
  if (!counterEl) return;
  counterEl.innerHTML = '<span class="num">' + checkedCount.toLocaleString() + '</span> Searching for ' + fmtUptime(Date.now() - bootT) + ' · keys checked'
    + ' · 0 collisions found so far ··· ';
}
setInterval(updateCounter, 1000); // keep the uptime ticking even when idle

async function topUpQueue() {
  if (queue.length >= config.KEY_QUEUE_TARGET) return;
  const need = config.KEY_QUEUE_TARGET - queue.length + config.BATCH_KEYS;
  try { queue.push(...await requestKeys(need)); } catch (err) { console.error('keyscape: key generation failed', err); }
}

async function engineLoop() {
  await workerReady;
  info.textContent = "Checking random cryptographic keys is knocking on heaven's ~10^77 doors"
  let injectHit = DEBUG_HIT;

  while (!hitHalted) {
    await topUpQueue();
    if (queue.length === 0) { await sleep(200); continue; }

    const batch = queue.splice(0, Math.min(checker.batchKeys, queue.length));
    if (injectHit) { injectHit = false; batch[0] = DEBUG_KEYCHAIN; }

    let res;
    try { res = await checker.checkBatch(batch); }
    catch (err) { console.warn('keyscape: batch failed, backing off:', err.message); await sleep(800); continue; }

    for (const rec of res.records) {
      checkedCount++;
      logKey(rec, res.url);
      viz.addRecord(rec); // viz staggers the falling-key rain from buffered keys
      if (isHit(rec.status)) {
        const outcome = await hit.handle(rec, res.url);
        if (outcome === 'fired') break;
      }
    }
    updateCounter();
    await sleep(0); // yield to the render loop
  }
  info.textContent = 'halted - a key was found. see the overlay.';
}

engineLoop().catch((err) => {
  console.error('keyscape: could not start', err);
  info.textContent = 'could not start: ' + err.message;
});
