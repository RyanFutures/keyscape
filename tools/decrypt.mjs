// Developer tool: decrypt an keyscape hit payload with your secp256k1
// private key (the one matching DEV_PUBLIC_KEY in src/config.js).
//
//   node tools/decrypt.mjs <payload-base64 | path-to-file-containing-it>
//
// The private key is NEVER taken as an argument (that would leave it in shell
// history and in the process list). It is read from a hidden prompt, or from
// stdin when piped, e.g.:  pass show keyscape | node tools/decrypt.mjs <payload>
// It is never printed or logged.
//
// The payload is the "payload" field of the Formspree email, or the "encrypted"
// field of the localStorage record keyscape_hit_<address>.

import fs from 'node:fs';
import { eciesDecrypt } from '../src/crypto.js';

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      // Piped: read the first line of stdin.
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0].trim()));
      stdin.on('error', reject);
      return;
    }
    process.stderr.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const done = (fn) => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stderr.write('\n'); fn(); };
    function onData(chunk) {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value.trim()));
        if (ch === '\u0003') return done(() => reject(new Error('cancelled'))); // Ctrl-C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);       // backspace
        else value += ch;
      }
    }
    stdin.on('data', onData);
  });
}

const arg = process.argv[2];
if (!arg || process.argv.length > 3) {
  console.error('usage: node tools/decrypt.mjs <payload-base64 | file>   (the private key is prompted for, never passed as an argument)');
  process.exit(1);
}
let payload = arg;
try { if (fs.existsSync(arg) && fs.statSync(arg).isFile()) payload = fs.readFileSync(arg, 'utf8').trim(); } catch { /* treat as literal payload */ }

let priv;
try { priv = await readHidden('Private key (hidden): '); } catch (err) { console.error(err.message); process.exit(1); }
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(priv)) {
  console.error('That is not a 32-byte hex private key (64 hex characters, optional 0x). Nothing was decrypted.');
  process.exit(1);
}
try {
  console.log(await eciesDecrypt(priv, payload));
} catch (err) {
  console.error('Decrypt failed - wrong private key, or the payload is incomplete/corrupted. (' + err.message + ')');
  process.exit(1);
}
