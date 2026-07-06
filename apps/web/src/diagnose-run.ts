import type { GraphClientOptions } from "@fiber-route-doctor/core";

export interface DiagnoseClientInput {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * Build the GraphClient options for a Diagnose run, attaching the biscuit token
 * when the operator has selected/pasted one. An empty or whitespace-only token
 * yields `biscuit: undefined` (unauthenticated), mirroring the Health and
 * Liquidity panels. Whitespace is trimmed so a token pasted with a trailing
 * newline still authenticates.
 */
export function graphClientOptionsFor(input: DiagnoseClientInput): GraphClientOptions {
  return {
    url: input.url,
    biscuit: input.token.trim() || undefined,
    fetchImpl: input.fetchImpl
  };
}
