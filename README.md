# Keyscape

This is a refresh and re-implementation of an older project that was lovingly and painstakingly crafted by my hand, character by character. V1 was designed and tested to be run on specifically difficult low-power hardware, to serve as a work of art and demonstration of the nature of cryptographic keys, and save that hardware from it's fate of becoming e-waste just a little longer.

The code for this reimplementation was written by AI/LLM/Claude. That's why it is hosted here on github, in the belly of the great beast microsoft. My git forges of choice have banned anything smelling of slop or crypto from their platforms, so out of respect I will not lie, I'll simply be hosting my crypto slop here where it belongs.

Some TODOs and things to verify:
 - does it work on any device when static-hosted on github-pages? YES IT WORKS!
 - does it work on our target device? KIND OF! only the light-mode colours are legible. needs work.
 - does it download keys it finds in a way that survives a power failure?
 - will a Toronto gallery pay me to hang it? Allow me to hang it?
 - Currently hosted at https://ryanfutures.github.io/keyscape/ - add a cool domain like keyscape.futures.love maybe?
 - Wants to be independently reviewed by a technologist, an artist, and a normie.
 - Missing a cool favicon?
 - Make sure no public-facing prose on the page is not handwritten. Don't forcefeed anyone slop!
 - make a video comparison of V1 to this implementation
 - get all the TODOs out of your discord chat from when you prompted up this slop
 - try installing chrome on the target device?
 - document the settings and state of the target device
 - legibility testing
 - add an explainer or readme link to the frontend, people are confused what it is
 - 3d print a frame for the target device to be hung on the wall in


I wrote those words above. Below this line, everything is Claude's words. Even I have not read them.

=========================================================================

A from-scratch rewrite of the Ethereum KeyScape. It generates random Ethereum
keypairs, checks each derived address against the live chain, and visualizes the
result on three rotating Hilbert-curve cubes - a demonstration of how
implausible a key collision is. Static, no server, no build step.

## How it works

A key-generation worker streams random keypairs; the main thread batch-checks
their balance and nonce against a pool of keyless public RPC endpoints and emits
a list of checked keys; the visualization follows that list, so every key on
screen was genuinely queried. A "hit" is a key whose address is REAL on-chain -
funded OR previously used (nonce > 0); the point is whether the random sequence
is a real address, not whether it holds money. A hit is re-verified on a second
endpoint, encrypted to the developer's public key, persisted and shown locally,
and sent off-device best-effort. Hits are effectively impossible - the hit path
exists to make the demonstration authentic, not because it will fire.

The forced-hit test (`?debughit=1`) injects the standard Hardhat/Anvil account #0
(`0xf39Fd6…92266`, its private key is public): it has transacted on mainnet
(nonce > 0, 0 balance), so it is a genuine used-empty hit and re-verification
passes truthfully.

## Layout

    index.html              shell: importmap + one module entry
    src/
      main.js               wiring: worker -> queue -> checker -> list -> viz + hit
      config.js             endpoints, dev public key, form ids, tunables
      key-worker.js         module worker: noble keygen (off the main thread)
      rpc-pool.js           endpoint pool: round-robin, failover, backoff
      checker.js            batched balance+nonce, status classification
      crypto.js             ECIES (noble ECDH + HKDF + WebCrypto AES-GCM)
      hit.js                re-verify, encrypt, persist/display, email, halt
      viz.js                three.js scene, pooled ring-buffer connections
      hilbert.js            Hilbert curve + key->vertex mapping (pure)
    vendor/                 pinned, self-contained: three, noble, font
    tests/units.mjs         pure-unit checks (no network)
    tests/fixtures/         real mainnet transactions used by the recovery test
    tools/decrypt.mjs       developer's offline decrypt tool
    tools/pubkey-from-address.mjs   recover a wallet's public key from its own txs

## Configure the hit email

Delivery is via **Web3Forms** (`api.web3forms.com`). Verified end to end in a real
browser on 2026-11-18: a forced hit returned `[web3forms] 200 {"success":true}` and
the email arrived. (It replaced Formspree, whose account was blocked.) Values in
`src/config.js`:

- `DEV_PUBLIC_KEY` - secp256k1 **public** key a found key is ECIES-encrypted to;
  only the matching private key can read it. Safe to embed. Currently the key of
  wallet `0xA831D11C0c280B118C5f44B192A327cf64D9eE91`.
- `WEB3FORMS_ACCESS_KEY` - the Web3Forms access key (a UUID, emailed when you
  register an inbox at web3forms.com). Public and safe to embed.

The email is a plain notification with no cleartext address and no alarming wording;
the found key and its context are only inside the encrypted block (armored with
`-----BEGIN KEYSCAPE ENCRYPTED MESSAGE-----`), so it does not read like a key dump.

Two Web3Forms dashboard settings matter: do NOT enable a captcha (the page submits
with no human to solve it), and leave the inbox as the one you want hits delivered to.

Notes:
- Web3Forms (behind Cloudflare) only accepts submissions from a real browser; `curl`,
  headless browsers and server-side calls are rejected. The request uses `FormData`
  (a CORS "simple" request) - a JSON body triggers a preflight that Web3Forms 403s.
- Free plan rate-limits per IP; too many in a short time blocks the IP for ~1 hour.

To hand over to another owner (e.g. the designer):

1. Get their public key. An address is not enough - it is a one-way hash of the key.
   If their wallet has sent at least one transaction, recover it:
   `node tools/pubkey-from-address.mjs <their-address>` (prints the key only after
   checking it re-derives the address). Put it in `DEV_PUBLIC_KEY`.
2. Put their Web3Forms access key in `WEB3FORMS_ACCESS_KEY`.
3. Run one forced hit on localhost and have them decrypt it (below).

Delivery behavior: a hit is stored locally first (only the ciphertext), then sent.
Network errors, 429 and 5xx are retried after 30 s, 2 min, 10 min, 30 min and 2 h;
other errors stop and show on the overlay. A hit not yet confirmed sent is re-sent
automatically the next time the page loads.
- `RPC_ENDPOINTS` - the keyless, CORS-enabled pool (defaults verified 2026-11-18),
  as `{ url, maxCalls? }`. `maxCalls` seeds a known batch limit; the pool also
  learns limits from HTTP 400s. Pacing (`RPC_PER_CALL_MS`) counts calls, since
  most free endpoints rate-limit per call, not per request.

Every open tab is a separate client on the same IP, sharing each endpoint's
free budget - several tabs at once will see more 429s (they are absorbed by
failover, but show in the console).

Everything in this file is public and safe to ship. No secret belongs here.

## Run and test

    # serve locally (any static server)
    python3 -m http.server -d .            # then open http://localhost:8000/

    node tests/units.mjs                   # pure-unit checks

    # in the browser:
    ?debughit=1                            # force the full hit chain once - sends a REAL "(test)" email;
                                           # honored on localhost / 127.0.0.1 only. Use a real browser
                                           # (Web3Forms blocks headless); counts against the IP rate limit
    ?failrpc=publicnode                    # force an endpoint to fail, exercising failover
    ?failrpc=all                           # force all endpoints down

## Reading a hit

A hit arrives as an ECIES payload (inside the email's
`-----BEGIN KEYSCAPE ENCRYPTED MESSAGE-----` block, or the `encrypted` field of
`localStorage` key `ethkeyscape_hit_<address>`). Decrypt it on a machine you trust:

    node tools/decrypt.mjs <payload-base64 | file>

The private key is asked for at a hidden prompt (or read from stdin when piped,
e.g. from a password manager). It is never taken as an argument, so it does not
end up in shell history or the process list. When `DEV_PUBLIC_KEY` is a live
wallet's key, that prompt is the only place its private key should ever be typed.

## Deploying

This app is self-contained under `public/v2/` and serves at `/ethkeyscape/v2/`.
To make it the site root, move its contents up to `public/` (replacing the old
`index.html`). The 2017-era `index.html` and experiment pages are superseded.
