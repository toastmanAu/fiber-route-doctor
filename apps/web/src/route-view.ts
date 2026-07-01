import type { RouteReport } from "@fiber-route-doctor/core";

export interface RouteViewNode {
  id: string;
  label: string;
  role: "source" | "hop" | "target";
}

export interface RouteViewEdge {
  from: string;
  to: string;
  label: string;
}

export interface RouteView {
  verdict: "payable" | "risky" | "blocked";
  color: string;
  nodes: RouteViewNode[];
  edges: RouteViewEdge[];
  reasons: string[];
}

function short(hex: string): string {
  return hex.slice(0, 10);
}

function getColorForVerdict(verdict: "payable" | "risky" | "blocked"): string {
  switch (verdict) {
    case "payable":
      return "#2e7d32";
    case "risky":
      return "#f9a825";
    case "blocked":
      return "#c62828";
  }
}

export function buildRouteView(report: RouteReport): RouteView {
  const color = getColorForVerdict(report.verdict);
  const reasons = report.reasons.map((r) => `[${r.cause}] ${r.detail}`);

  if (report.path.length === 0) {
    // Blocked case: just source and target nodes
    const nodes: RouteViewNode[] = [
      {
        id: report.probe.source,
        label: short(report.probe.source),
        role: "source",
      },
      {
        id: report.probe.target,
        label: short(report.probe.target),
        role: "target",
      },
    ];

    return {
      verdict: report.verdict,
      color,
      nodes,
      edges: [],
      reasons,
    };
  }

  // Path found: build node list from source -> hops -> target
  const nodes: RouteViewNode[] = [
    {
      id: report.path[0].from,
      label: short(report.path[0].from),
      role: "source",
    },
  ];

  for (const hop of report.path) {
    nodes.push({
      id: hop.to,
      label: short(hop.to),
      role: nodes.length === report.path.length ? "target" : "hop",
    });
  }

  // Last node is always target
  nodes[nodes.length - 1].role = "target";

  // Build edges
  const edges: RouteViewEdge[] = report.path.map((hop) => ({
    from: hop.from,
    to: hop.to,
    label: `fee ${hop.fee} · ${short(hop.channelOutpoint)}`,
  }));

  return {
    verdict: report.verdict,
    color,
    nodes,
    edges,
    reasons,
  };
}
