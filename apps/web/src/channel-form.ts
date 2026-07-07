/** Decimal CKB string -> shannon (1e8) 0x-hex. Mirrors the CLI's ckbToShannonHex. */
export function parseCkbAmount(s: string): string {
  if (!/^\d+(\.\d{1,8})?$/.test(s.trim())) throw new Error("invalid CKB amount (digits with up to 8 decimal places)");
  const [whole, frac = ""] = s.trim().split(".");
  const shannons = BigInt(whole) * 100_000_000n + BigInt(frac.padEnd(8, "0"));
  if (shannons <= 0n) throw new Error("amount must be greater than 0");
  return `0x${shannons.toString(16)}`;
}

/** 0x-hex shannons -> CKB decimal string with trailing zeros trimmed. */
export function shannonHexToCkb(hex: string): string {
  const v = BigInt(hex);
  const whole = v / 100_000_000n;
  const frac = (v % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** -32999 guidance: if a read (list_channels) succeeded with the same token, the write scope is missing. */
export function unauthorizedHint(readProbeSucceeded: boolean): string {
  return readProbeSucceeded
    ? "Unauthorized: token scope is insufficient for this operation — mint an 'operator' token (connect_peer needs write(\"peers\"), channel ops need write(\"channels\"))."
    : "Unauthorized: token was not accepted at all — it must be minted from the node's own biscuit key (import the node key in the Wallet, then mint).";
}

export const PENDING_STATES: ReadonlySet<string> = new Set([
  "NegotiatingFunding", "CollaboratingFundingTx", "SigningCommitment", "AwaitingChannelReady"
]);
