// Recover an Ethereum account's secp256k1 PUBLIC key from one of its own signed
// transactions, for use as DEV_PUBLIC_KEY in src/config.js. An address is a
// one-way hash of the public key, so the key is only recoverable if the address
// has SENT at least one transaction.
//
//   node tools/pubkey-from-address.mjs <address> [--rpc URL] [--blockscout URL]
//
// Finds the address's sent transactions via Blockscout's keyless API (mainnet by
// default), fetches each over JSON-RPC, rebuilds its signing hash, recovers the
// signer, and prints the key ONLY if it re-derives the given address.
// Supports transaction types 0 (legacy, pre- and post-EIP-155), 1 and 2.

import { pathToFileURL } from 'node:url';
import { Signature, keccak_256 } from '../vendor/noble.js';

// --- byte helpers ---
const hexToBytes = (h) => {
  h = h.replace(/^0x/, '');
  if (h.length % 2) h = '0' + h;
  return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
};
const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const cat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrs) { out.set(a, i); i += a.length; }
  return out;
};

// --- minimal RLP encoder ---
const lenBytes = (n) => hexToBytes(n.toString(16));
const rlpBytes = (b) => (b.length === 1 && b[0] < 0x80) ? b
  : b.length <= 55 ? cat([0x80 + b.length], b)
  : cat([0xb7 + lenBytes(b.length).length], lenBytes(b.length), b);
const rlpList = (items) => {
  const p = cat(...items);
  return p.length <= 55 ? cat([0xc0 + p.length], p) : cat([0xf7 + lenBytes(p.length).length], lenBytes(p.length), p);
};
const rlpInt = (h) => { const n = BigInt(h); return rlpBytes(n === 0n ? new Uint8Array() : hexToBytes(n.toString(16))); };
const rlpData = (h) => rlpBytes(h ? hexToBytes(h) : new Uint8Array());
const rlpAccessList = (list) => rlpList((list || []).map((e) =>
  rlpList([rlpData(e.address), rlpList(e.storageKeys.map((k) => rlpData(k)))])));

// Signing hash and recovery bit for an eth_getTransactionByHash result.
export function signingHashAndRecovery(tx) {
  const type = Number(BigInt(tx.type ?? '0x0'));
  if (type === 2) {
    const payload = rlpList([rlpInt(tx.chainId), rlpInt(tx.nonce), rlpInt(tx.maxPriorityFeePerGas), rlpInt(tx.maxFeePerGas),
      rlpInt(tx.gas), rlpData(tx.to), rlpInt(tx.value), rlpData(tx.input), rlpAccessList(tx.accessList)]);
    return { hash: keccak_256(cat([0x02], payload)), recovery: Number(BigInt(tx.yParity ?? tx.v)) };
  }
  if (type === 1) {
    const payload = rlpList([rlpInt(tx.chainId), rlpInt(tx.nonce), rlpInt(tx.gasPrice), rlpInt(tx.gas),
      rlpData(tx.to), rlpInt(tx.value), rlpData(tx.input), rlpAccessList(tx.accessList)]);
    return { hash: keccak_256(cat([0x01], payload)), recovery: Number(BigInt(tx.yParity ?? tx.v)) };
  }
  if (type === 0) {
    const v = BigInt(tx.v);
    const base = [rlpInt(tx.nonce), rlpInt(tx.gasPrice), rlpInt(tx.gas), rlpData(tx.to), rlpInt(tx.value), rlpData(tx.input)];
    if (v >= 35n) { // EIP-155: v = chainId * 2 + 35 + recovery
      const chainId = (v - 35n) / 2n;
      return { hash: keccak_256(rlpList([...base, rlpInt('0x' + chainId.toString(16)), rlpInt('0x0'), rlpInt('0x0')])), recovery: Number(v - 35n - chainId * 2n) };
    }
    return { hash: keccak_256(rlpList(base)), recovery: Number(v - 27n) }; // pre-EIP-155: v = 27 + recovery
  }
  throw new Error(`unsupported transaction type ${type}`);
}

// Recover the signer's public key. Returns { compressed, uncompressed, address }.
export function recoverPublicKey(tx) {
  const { hash, recovery } = signingHashAndRecovery(tx);
  const point = new Signature(BigInt(tx.r), BigInt(tx.s)).addRecoveryBit(recovery).recoverPublicKey(hash);
  const uncompressed = point.toRawBytes(false);
  return {
    compressed: '0x' + toHex(point.toRawBytes(true)),
    uncompressed: '0x' + toHex(uncompressed),
    address: '0x' + toHex(keccak_256(uncompressed.subarray(1)).subarray(-20)),
  };
}

// --- CLI ---
async function rpcCall(urls, method, params) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const json = await res.json();
      if (json.result !== undefined) return json.result;
      lastErr = new Error(JSON.stringify(json.error || json));
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function main(argv) {
  const args = [...argv];
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const rpcOverride = flag('--rpc');
  const blockscout = (flag('--blockscout') || 'https://eth.blockscout.com').replace(/\/$/, '');
  const address = args[0];
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    console.error('usage: node tools/pubkey-from-address.mjs <0x-address> [--rpc URL] [--blockscout URL]');
    return 1;
  }
  const { RPC_ENDPOINTS } = await import('../src/config.js');
  const urls = rpcOverride ? [rpcOverride] : RPC_ENDPOINTS.map((e) => (typeof e === 'string' ? e : e.url));

  const nonce = BigInt(await rpcCall(urls, 'eth_getTransactionCount', [address, 'latest']));
  if (nonce === 0n) {
    console.error(`${address} has never sent a transaction on this chain, so its public key is not on chain.`);
    return 1;
  }

  const res = await fetch(`${blockscout}/api/v2/addresses/${address}/transactions?filter=from`);
  if (!res.ok) { console.error(`Blockscout lookup failed: HTTP ${res.status}`); return 1; }
  const items = (await res.json()).items || [];
  for (const item of items.slice(0, 20)) {
    try {
      const tx = await rpcCall(urls, 'eth_getTransactionByHash', [item.hash]);
      if (!tx || tx.from.toLowerCase() !== address.toLowerCase()) continue;
      const key = recoverPublicKey(tx);
      if (key.address.toLowerCase() !== address.toLowerCase()) continue; // never print an unverified key
      console.log(`address:    ${address}`);
      console.log(`from tx:    ${item.hash} (type ${Number(BigInt(tx.type ?? '0x0'))})`);
      console.log(`verified:   recovered key re-derives the address`);
      console.log(`public key: ${key.compressed}`);
      return 0;
    } catch (err) {
      // unsupported type or fetch error: try the next transaction
    }
  }
  console.error(`Could not recover a verified public key from ${items.length} sent transaction(s).`);
  return 1;
}

// Run only when invoked as a script, not when imported (tests, REPL, -e).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err.message || err); process.exit(1); });
}
