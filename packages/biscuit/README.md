# @fiber-route-doctor/biscuit

Mint, recall, and inspect Fiber biscuit RPC tokens with human-friendly seed-phrase key custody. Fills the gap Fiber leaves: `fnn` mandates biscuit auth on public nodes but ships no minting or key tooling.

## Keys (operator)

```bash
fiber-route-doctor keys init --passphrase '<pass>'        # new mnemonic → prints public key for node config
fiber-route-doctor keys import --hex ~/.fiber-dt/biscuit_private_key --passphrase '<pass>'
fiber-route-doctor keys export-public
```

## Tokens

```bash
fiber-route-doctor token generate --scope readonly --expiry 30d --profile mynode --url http://127.0.0.1:8231 --passphrase '<pass>'
fiber-route-doctor token list
fiber-route-doctor token show mynode
fiber-route-doctor token inspect @mynode --pubkey ed25519/<hex>
```

Scopes: `readonly` (all reads — enough for Route Doctor), `invoicing`, `full`.

## Security

Keys/seeds are encrypted at rest (scrypt + XChaCha20-Poly1305) under your passphrase; nothing is stored in plaintext and nothing leaves your machine. Keystore + profiles live in `~/.config/fiber-route-doctor/` (mode 600).

MIT.
