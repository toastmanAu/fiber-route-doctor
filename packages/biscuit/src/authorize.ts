import { Biscuit, PublicKey, SignatureAlgorithm, authorizer } from "@biscuit-auth/biscuit-wasm";

/** biscuit-wasm's PublicKey.fromString wants RAW hex; the stored form is "ed25519/<hex>". */
export function publicKeyHex(publicKeyString: string): string {
  return publicKeyString.replace(/^ed25519\//, "");
}

/** Replicates Fiber's per-method authorizer offline: true if the token satisfies policyCode at `now`. */
export function authorizeLocally(
  tokenB64: string, publicKeyString: string, policyCode: string, now: Date = new Date()
): boolean {
  try {
    const token = Biscuit.fromBase64(tokenB64, PublicKey.fromString(publicKeyHex(publicKeyString), SignatureAlgorithm.Ed25519));
    const ab = authorizer`time(${now});`;
    ab.addCode(policyCode);
    ab.buildAuthenticated(token).authorize();
    return true;
  } catch {
    return false;
  }
}
