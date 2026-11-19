// Key-generation worker. secp256k1 scalar multiplication and keccak are
// CPU-heavy, so they run off the main thread to keep the animation smooth.
// Imports the vendored noble bundle by RELATIVE path: import maps do not apply
// inside workers across all browsers, so bare specifiers are avoided here.
//
// Protocol (main thread drives, so generation never runs unbounded):
//   main -> worker: { type: 'make', n, reqId }
//   worker -> main: { type: 'keys', reqId, keys: [{ priv, pub, addr }, ...] }
//   worker -> main: { type: 'ready' }           (once, on startup)
//   worker -> main: { type: 'error', message }  (if noble fails to load/run)

import { getPublicKey, keccak_256, utils } from '../vendor/noble.js';

const HEX = '0123456789abcdef';
function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return s;
}

function makeKeychain() {
  const priv = utils.randomPrivateKey();          // 32 bytes, cryptographically random
  const pub = getPublicKey(priv, false);          // 65 bytes uncompressed (0x04 || X || Y)
  const addr = keccak_256(pub.subarray(1)).subarray(-20); // keccak256(X||Y), last 20 bytes
  return { priv: toHex(priv), pub: toHex(pub), addr: '0x' + toHex(addr) };
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== 'make') return;
  try {
    const keys = new Array(msg.n);
    for (let i = 0; i < msg.n; i++) keys[i] = makeKeychain();
    self.postMessage({ type: 'keys', reqId: msg.reqId, keys });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};

// Prove the worker and its crypto loaded before the engine starts the loop.
try {
  makeKeychain();
  self.postMessage({ type: 'ready' });
} catch (err) {
  self.postMessage({ type: 'error', message: 'key worker failed to initialize: ' + String(err && err.message || err) });
}
