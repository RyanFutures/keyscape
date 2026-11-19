// ECIES on secp256k1, built from audited primitives (noble) + native WebCrypto
// AES-256-GCM. A found private key is encrypted to the developer's public key so
// that only the developer can read it; nothing in this page can decrypt it.
//
// Scheme (both sides must match):
//   ephemeral secp256k1 keypair -> ECDH with recipient pubkey -> shared point
//   HKDF-SHA256(shared, info) -> 32-byte AES key
//   AES-256-GCM(iv=12B random) over the plaintext
//   payload = base64( version(1) || ephPubCompressed(33) || iv(12) || ct+tag )
//
// decrypt() is the inverse, for the forced-hit test and for the developer's
// offline tool. No dependency on eciesjs or a Buffer polyfill.

import { getPublicKey, getSharedSecret, utils, hkdf, sha256, ProjectivePoint, keccak_256 } from '../vendor/noble.js';

const VERSION = 1;
const INFO = new TextEncoder().encode('keyscape-ecies-aes256gcm');

function hexToBytes(hex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2) throw new Error('odd-length hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}
function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(sharedPoint, usage) {
  const keyBytes = hkdf(sha256, sharedPoint, undefined, INFO, 32);
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, [usage]);
}

// Encrypt a string or Uint8Array to a secp256k1 public key (hex). Returns base64.
export async function eciesEncrypt(recipientPublicKeyHex, message) {
  if (!recipientPublicKeyHex) throw new Error('no recipient public key configured');
  const recipientPub = hexToBytes(recipientPublicKeyHex);
  const ephPriv = utils.randomPrivateKey();
  const ephPub = getPublicKey(ephPriv, true);                 // 33-byte compressed
  const shared = getSharedSecret(ephPriv, recipientPub, true); // 33-byte compressed point
  const key = await deriveKey(shared, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return toBase64(concat(new Uint8Array([VERSION]), ephPub, iv, ct));
}

// Decrypt a base64 payload with the recipient's secp256k1 private key (hex).
// Returns the plaintext string.
export async function eciesDecrypt(recipientPrivateKeyHex, payloadB64) {
  const buf = fromBase64(payloadB64);
  if (buf[0] !== VERSION) throw new Error('unknown payload version ' + buf[0]);
  const ephPub = buf.subarray(1, 34);
  const iv = buf.subarray(34, 46);
  const ct = buf.subarray(46);
  const shared = getSharedSecret(hexToBytes(recipientPrivateKeyHex), ephPub, true);
  const key = await deriveKey(shared, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// The Ethereum address of a secp256k1 public key (compressed or uncompressed hex):
// keccak256 of the uncompressed point's X||Y, last 20 bytes. Throws on a bad key.
export function addressFromPublicKey(publicKeyHex) {
  const clean = publicKeyHex.startsWith('0x') ? publicKeyHex.slice(2) : publicKeyHex;
  const uncompressed = ProjectivePoint.fromHex(clean).toRawBytes(false); // 0x04 || X || Y
  return '0x' + bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(-20));
}

// Helpers reused by the forced-hit test to make a throwaway recipient keypair.
export function randomKeypair() {
  const priv = utils.randomPrivateKey();
  return { priv: bytesToHex(priv), pub: bytesToHex(getPublicKey(priv, true)) };
}
export { bytesToHex, hexToBytes };
