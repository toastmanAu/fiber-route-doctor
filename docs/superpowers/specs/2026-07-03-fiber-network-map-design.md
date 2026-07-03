# Fiber Network Map — Design

**Date:** 2026-07-03
**Status:** Approved (approach + all sections approved by Phill)
**Piece:** Fifth tool in the Fiber Ops toolkit (after Route Doctor, Biscuit Manager, Health Probe, Liquidity Snapshot).

## Purpose

Visualize the live gossiped Fiber network topology (`graph_nodes` + `graph_channels`) as an interactive force-directed map: who's connected to whom, where capacity concentrates, which channels are disabled, where YOUR node sits — and overlay a diagnosed route from Route Doctor on top. Ships as an interactive web panel AND a self-contained HTML export (shareable/hostable hackathon artifact).

## Data source (already grounded)

`GraphClient.graphNodes(): RpcGraphNode[]` (`pubkey`, `node_name`, `addresses`) and `GraphClient.graphChannels(): RpcChannelInfo[]` (`channel_outpoint`, `node1`, `node2`, `capacity` u128 hex, `funding_udt_type_script`, `update_info_of_node1/2.enabled`) — both live-validated (500 channels). Own pubkey via `HealthClient.nodeInfo().pubkey` when a token is available. Scopes: `read("graph")` (+ `read("node")` for own-node marking) — covered by the `readonly` token template.

## Approach (approved: A)

Shared pure model + **deterministic d3-force layout in core**, consumed identically by the browser (web panel) and Node (CLI HTML export). `d3-force` becomes `packages/core`'s first runtime dependency (`d3-force` + dev-dep `@types/d3-force`) — pure isomorphic JS, layout math only; all rendering stays hand-rolled SVG per repo convention.

### Core (`packages/core`)

- **`network-map-types.ts`**
  - `MapNode = { pubkey: Hex; name: string | null; degree: number; totalCapacity: string; isolated: boolean; isOwn: boolean }`
  - `MapEdge = { outpoint: Hex; a: Hex; b: Hex; capacity: string; disabled: boolean }` — `disabled` = NEITHER direction enabled (`update_info_of_node1/2`, null update info counts as not-enabled for that direction).
  - `HubEntry = { pubkey: Hex; name: string | null; degree: number; totalCapacity: string }`
  - `NetworkMapModel = { nodes: MapNode[]; edges: MapEdge[]; hubs: HubEntry[]; stats: { nodeCount: number; channelCount: number; totalCapacity: string } }`
  - `LayoutPoint = { x: number; y: number }`
- **`network-map.ts`** — `buildNetworkMapModel(graphNodes: RpcGraphNode[], graphChannels: RpcChannelInfo[], ownPubkey?: Hex): NetworkMapModel`
  - Nodes appearing only as channel endpoints (not in `graph_nodes`) are synthesized with `name: null`.
  - Per-node `degree` (channel count) and `totalCapacity` (bigint sum of its channels' capacities → decimal string).
  - `isolated` = present in `graph_nodes` with zero channels. `isOwn` = pubkey equals `ownPubkey`.
  - `hubs` = top 10 by `totalCapacity` (bigint compare), ties by higher `degree`, then pubkey ascending. `stats.totalCapacity` = sum over channels (each channel counted once).
- **`network-layout.ts`** — `computeLayout(model: NetworkMapModel, opts: { width: number; height: number; ticks?: number }): Map<Hex, LayoutPoint>`
  - d3-force: `forceLink` (id by pubkey, distance shrinking with edge capacity), `forceManyBody` (repulsion), `forceCenter(width/2, height/2)`, `forceCollide`.
  - **Deterministic:** explicit initial positions (phyllotaxis: `i`-indexed radius/angle formula, no randomness), `simulation.stop()` then a manual loop of `ticks` (default 300) `simulation.tick()` calls. Final positions clamped to `[margin, width-margin] × [margin, height-margin]`.
  - Same-input → identical output (unit-tested).

### Web (`apps/web`)

- **`network-map-view.ts`** (pure, unit-tested) — `buildNetworkMapView(model, positions, routeOutpoints?: Hex[])`:
  - Node radius 4–20px by sqrt-scale of `totalCapacity` (named constants `NODE_R_MIN/MAX`); edge width 1–6px by sqrt-scale of capacity (`EDGE_W_MIN/MAX`).
  - Colors: own node `#3498db`, hub nodes `#2ecc71`, isolated `#e74c3c`, default `#95a5a6`; disabled edges dashed `#e74c3c`; route-overlay edges (outpoint ∈ routeOutpoints) `#f1c40f` at +2px width; default edges `#7f8c8d`.
  - Output rows carry everything the component needs (positions, r, colors, dash, labels for named nodes).
- **`NetworkMapPanel.tsx`** — url/token(password) form + "Load map" button (busy-disabled); fetches `graphNodes` + `graphChannels` (+ `nodeInfo` for own pubkey when a token is provided; tolerate its failure), `buildNetworkMapModel` → `computeLayout` in `useMemo`, SVG with viewBox pan (pointer drag) + zoom (wheel, clamped), node click → details card (name, pubkey, addresses, degree, capacity), hubs top-10 list beside the map, stats line.
  - Accepts optional `routeOutpoints?: string[]` prop. `App.tsx` lifts the last diagnosis's `report.path` channel outpoints and passes them down, so running Diagnose highlights the route on the map.
- Wired into `App.tsx` after `<LiquidityPanel />`.

### CLI (`apps/cli`)

- `dispatch.ts` gains `"map"`; `commands/map.ts`:
  - Flags: `--url` (required) + standard token resolution (`--biscuit`/`--auth-token-file`/`--profile`/`FNN_AUTH_TOKEN`), `--out <path>` (default `fiber-map.html`), `--json` (print the model instead of writing HTML), `--width`/`--height` (defaults 1200×800, validated integers 200..8000).
  - Flow: fetch → model (own pubkey from `nodeInfo` when token resolves; tolerate failure) → layout in Node → `renderMapHtml(model, positions, opts): string` → write file → print `wrote <path> (<nodes> nodes, <channels> channels)`.
  - **`renderMapHtml`** (in `apps/cli/src/map-html.ts`, pure string builder, unit-tested): fully self-contained HTML — inline `<svg>` using the shared scales/colors from `packages/core/src/network-map-style.ts`, embedded `<script type="application/json">` model payload, ~40 lines of inline vanilla JS for node-click details + hover highlight. NO external URLs (CSP-safe, works from file://). The biscuit token must never appear in the HTML.
  - Exit codes: 0 success, 2 usage/probe errors (main().catch handles throws).

To avoid color/scale drift between web and export, the scale/color constants live in ONE place: `packages/core/src/network-map-style.ts` (plain constants + pure scale functions, no DOM) — both `network-map-view.ts` and `map-html.ts` import from it.

## Error handling

- Empty graph (0 nodes/channels) → web shows "no gossiped topology — node may be isolated"; CLI writes an HTML that displays the same message, still exit 0 (an honest empty map is a valid artifact).
- `nodeInfo` failure (no/weak token) → map renders without own-node marking (no error).
- RPC failures propagate: web error banner; CLI exit 2 via main catch.

## Testing

- **Model tests** — fixtures: totals/degree math (bigint, u128-safe), disabled-edge rule (both/one/no directions enabled, null update info), synthesized endpoint nodes, isolated detection, hub ordering incl. tie by degree, stats.
- **Layout tests** — determinism (two runs, identical positions), all coordinates finite and within clamp bounds, distinct nodes at distinct positions for a small fixture; ticks parameter respected.
- **Style/scale tests** — radius/width scale boundaries (min at 0/zero-capacity, max at graph max), color selection precedence (own > hub > isolated > default).
- **Web view tests** — row building incl. route-overlay edge marking.
- **CLI tests** — args validation (out default, width/height bounds, json flag); `renderMapHtml`: contains `<svg`, embedded JSON payload, the stats line, NO `http://`/`https://` substrings (self-contained), and never the string of a provided token.
- **Gated live smoke** `npm run smoke:map`: fetch live topology, build model (expect >0 channels on driveThree's gossiped graph), compute layout, render HTML to a temp path, assert non-trivial size — prints node/channel counts.

## Out of scope / backlog

- Fee-rate heatmap coloring; time-travel/animation of topology changes.
- WebGL/canvas rendering (500 edges is fine in SVG).
- Graph search/filter box.
- Serving the exported HTML (it's a static file; hosting is a deliverables task).

## Composition story (demo)

```
fiber-route-doctor map --profile driveThree --url http://127.0.0.1:8231 --out fiber-map.html
# open fiber-map.html — the live network, your node highlighted, hubs ranked
# in the web app: Diagnose a payment, then watch the found route light up on the map
```
