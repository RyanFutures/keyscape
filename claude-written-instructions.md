I wrote those words above. Below this line, everything is Claude's words. Even I have not read them.

=========================================================================

Okay now I'm trimming it.
Now I'll move it to another file.

=====================================

The forced-hit test (`?debughit=1`) injects the standard Hardhat/Anvil account #0
(`0xf39Fd6…92266`, its private key is public): it has transacted on mainnet
(nonce > 0, 0 balance)

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

Delivery is via **Web3Forms**
Two Web3Forms dashboard settings matter: do NOT enable a captcha (the page submits
with no human to solve it), and leave the inbox as the one you want hits delivered to.

Delivery behavior: a hit is stored locally first (only the ciphertext), then sent.
Network errors, 429 and 5xx are retried after 30 s, 2 min, 10 min, 30 min and 2 h;
other errors stop and show on the overlay. A hit not yet confirmed sent is re-sent
automatically the next time the page loads.

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
