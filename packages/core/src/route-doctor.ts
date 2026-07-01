import { GraphModel } from "./graph-model.js";
import { GraphClient } from "./graph-client.js";
import { diagnose } from "./diagnose.js";
import { crossCheckRouter, type RouterCaller } from "./route-probe.js";
import type { ProbeRequest, ProbeResult, RouteReport } from "./types.js";

export async function loadGraph(client: GraphClient): Promise<GraphModel> {
  const [nodes, channels] = await Promise.all([client.graphNodes(), client.graphChannels()]);
  return GraphModel.fromRpc(nodes, channels);
}

export async function runDiagnosis(model: GraphModel, probe: ProbeRequest, router?: RouterCaller): Promise<RouteReport> {
  let probeResult: ProbeResult = { kind: "skipped" };
  if (router) probeResult = await crossCheckRouter(router, probe);
  return diagnose(model, probe, probeResult);
}
