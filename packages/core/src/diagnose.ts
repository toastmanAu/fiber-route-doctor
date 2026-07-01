import { findBestPath } from "./find-path.js";
import type { GraphModel } from "./graph-model.js";
import type { ProbeRequest, ProbeResult, Reason, RouteReport } from "./types.js";

const DEFAULT_MAX_FEE_RATE = 5n; // per-thousand (0.5%)

function feeWithinCeiling(totalFee: bigint, amount: bigint, maxFeeRate: bigint): boolean {
  // ceiling amount = amount * maxFeeRate / 1000
  return totalFee <= (amount * maxFeeRate) / 1000n;
}

export function diagnose(model: GraphModel, probe: ProbeRequest, probeResult: ProbeResult = { kind: "skipped" }): RouteReport {
  const path = findBestPath(model, probe);

  if (path !== null) {
    const reasons: Reason[] = [];
    const maxFeeRate = probe.maxFeeRate ?? DEFAULT_MAX_FEE_RATE;
    let risky = false;

    if (!feeWithinCeiling(path.totalFee, probe.amount, maxFeeRate)) {
      risky = true;
      reasons.push({ cause: "fee_over_limit", detail: `total fee ${path.totalFee} exceeds ceiling for maxFeeRate ${maxFeeRate}/1000` });
    }
    if (probe.maxTotalExpiry !== undefined && path.totalExpiry > probe.maxTotalExpiry) {
      risky = true;
      reasons.push({ cause: "expiry_over_limit", detail: `total expiry ${path.totalExpiry}ms exceeds ceiling ${probe.maxTotalExpiry}ms` });
    }

    const routerConfirmed = probeResult.kind === "router_path"
      && sameChannels(probeResult.channelOutpoints, path.hops.map(h => h.channelOutpoint));
    if (probeResult.kind === "router_error") {
      risky = true;
      reasons.push({ cause: "router_declined", detail: `node build_router declined: ${probeResult.message}` });
    }

    return {
      verdict: risky ? "risky" : "payable",
      probe, path: path.hops, totalFee: path.totalFee, totalExpiry: path.totalExpiry,
      reasons, fixes: [], routerConfirmed
    };
  }

  // Blocked branch — replaced with real attribution in Task 6.
  return { verdict: "blocked", probe, path: [], totalFee: 0n, totalExpiry: 0n, reasons: [], fixes: [], routerConfirmed: false };
}

function sameChannels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}
