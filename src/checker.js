// Turns keychains into checked records by batching balance + nonce lookups.
// Each key costs two RPC calls, both in one batch array. Adapts batch size down
// when the pool is struggling.

// An address is classified by what the chain shows: FUNDED (holds ETH),
// USED_EMPTY (has transacted but holds nothing now), or UNUSED (never seen).
export const STATUS = { UNUSED: 'unused', USED_EMPTY: 'used-empty', FUNDED: 'funded' };

// A "hit": the generated key maps to a REAL address - one that is funded OR has
// ever been used. The demonstration is about whether the random sequence is a
// real on-chain address, not whether it currently holds money.
export function isHit(status) { return status === STATUS.FUNDED || status === STATUS.USED_EMPTY; }

// A JSON-RPC quantity: 0x-prefixed hex. Anything else (missing, null, '',
// non-hex) is NOT a zero - it means the key was not actually checked.
const QUANTITY = /^0x[0-9a-fA-F]+$/;
export function isQuantity(v) { return typeof v === 'string' && QUANTITY.test(v); }

export function classify(balanceHex, nonceHex) {
  if (!isQuantity(balanceHex) || !isQuantity(nonceHex)) {
    throw new Error(`malformed RPC result: balance=${JSON.stringify(balanceHex)} nonce=${JSON.stringify(nonceHex)}`);
  }
  if (BigInt(balanceHex) > 0n) return STATUS.FUNDED;
  if (BigInt(nonceHex) > 0n) return STATUS.USED_EMPTY;
  return STATUS.UNUSED;
}

export class Checker {
  constructor(pool, { batchKeys = 25, minBatchKeys = 4, maxBatchKeys = 50 } = {}) {
    this.pool = pool;
    this.batchKeys = batchKeys;
    this.minBatchKeys = minBatchKeys;
    this.maxBatchKeys = maxBatchKeys;
  }

  // Check an array of keychains. Returns { records, url }. Throws only if the
  // whole batch could not be served by any endpoint (caller backs off/retries).
  async checkBatch(keychains) {
    const calls = [];
    for (const kc of keychains) {
      calls.push({ method: 'eth_getBalance', params: [kc.addr, 'latest'] });
      calls.push({ method: 'eth_getTransactionCount', params: [kc.addr, 'latest'] });
    }
    let reply;
    try {
      reply = await this.pool.batch(calls);
    } catch (err) {
      this.batchKeys = Math.max(this.minBatchKeys, Math.floor(this.batchKeys / 2));
      throw err;
    }
    // A key counts as checked only if BOTH answers are real quantities. A key
    // with an error or malformed result is dropped (not counted, not drawn) -
    // never recorded as empty.
    const records = [];
    let unchecked = 0;
    for (let i = 0; i < keychains.length; i++) {
      const bal = reply.results[i * 2];
      const nonce = reply.results[i * 2 + 1];
      if (bal.error || nonce.error || !isQuantity(bal.result) || !isQuantity(nonce.result)) { unchecked++; continue; }
      records.push({
        ...keychains[i],
        balanceHex: bal.result,
        nonceHex: nonce.result,
        status: classify(bal.result, nonce.result),
      });
    }
    if (unchecked) console.warn(`keyscape: ${unchecked}/${keychains.length} keys from ${reply.url} had errors or malformed results; not counted as checked`);
    // Recovered: let the batch size grow back toward the max.
    if (this.batchKeys < this.maxBatchKeys) this.batchKeys = Math.min(this.maxBatchKeys, this.batchKeys + 1);
    return { records, url: reply.url };
  }
}
