import { Biscuit, PublicKey, SignatureAlgorithm, authorizer } from "@biscuit-auth/biscuit-wasm";

/** biscuit-wasm's PublicKey.fromString wants RAW hex; the stored form is "ed25519/<hex>". */
export function publicKeyHex(publicKeyString: string): string {
  return publicKeyString.replace(/^ed25519\//, "");
}

/**
 * Datalog run limits passed to authorizeWithLimits().
 *
 * biscuit-wasm's default limits use an ~1ms max_time, which is easily exceeded
 * under CPU contention (observed in the full parallel test suite). A timeout is
 * NOT a logic denial, so we raise the ceiling generously to make spurious
 * timeouts practically impossible while still bounding runaway datalog.
 *
 * Shape matches biscuit-rust's `RunLimits` struct as compiled into this
 * package's WASM binary: `strings biscuit_bg.wasm` shows the serde field
 * names are `max_facts`, `max_iterations`, `max_time_micro` — a flat
 * microsecond integer, NOT a std::time::Duration `{secs, nanos}` pair as
 * biscuit-rust's public (non-WASM) API might suggest. Passing `{secs,nanos}`
 * is silently accepted as an unknown/extra field and `max_time_micro` falls
 * back to its ~1ms default, so the run limit never actually changes — this
 * cost an earlier iteration of this fix a false-green (1s and 5s "increases"
 * both still timed out because neither was ever applied). 5,000,000 micros
 * (5s) leaves ample headroom for WASM cold-start/JIT contention across
 * concurrently-spawned test workers while still catching genuine
 * runaway/malicious datalog policies.
 */
export const RUN_LIMITS = { max_facts: 1000, max_iterations: 100, max_time_micro: 5_000_000 };

/**
 * True if `e` is a biscuit-wasm run-limit timeout/overflow, not a genuine authorization failure.
 *
 * Matches ALL `RunLimit` variants biscuit-wasm can throw — `Timeout`, `TooManyFacts`, and
 * `TooManyIterations` alike — since the check only tests for the `"RunLimit"` key, not its value.
 * Any of these means the datalog engine gave up before it could reach a verdict.
 */
export function isRunLimitError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "RunLimit" in e;
}

/**
 * Replicates Fiber's per-method authorizer offline: true if the token satisfies policyCode at `now`.
 *
 * Exception contract: a thrown error means authorization could NOT be evaluated — the biscuit-wasm
 * run limit (facts/iterations/time, see RUN_LIMITS) was hit before the datalog engine reached a
 * verdict either way. This is NOT a policy denial. Callers MUST treat any exception from this
 * function as "not authorized" (fail closed) and MUST NOT interpret it as "allowed" — there is no
 * code path in which throwing means the token was accepted.
 */
export function authorizeLocally(
  tokenB64: string, publicKeyString: string, policyCode: string, now: Date = new Date()
): boolean {
  try {
    const token = Biscuit.fromBase64(tokenB64, PublicKey.fromString(publicKeyHex(publicKeyString), SignatureAlgorithm.Ed25519));
    const ab = authorizer`time(${now});`;
    ab.addCode(policyCode);
    ab.buildAuthenticated(token).authorizeWithLimits(RUN_LIMITS);
    return true;
  } catch (e) {
    if (isRunLimitError(e)) {
      throw new Error("biscuit authorization exceeded run limits: " + JSON.stringify(e));
    }
    return false;
  }
}
