# Gap Analysis Deliverable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `docs/GAP-ANALYSIS.md` (~4,500 words) — the hackathon's infra-gap analysis + roadmap deliverable, every claim carrying a verified proof pointer — committed, pushed, linked from README.

**Architecture:** Facts-first: Task 1 resolves every open verification item into a facts file; each drafting task verifies its pointers against that file + primary sources BEFORE writing prose (the prose analog of a failing test), drafts its sections into the single deliverable file, then self-fact-checks. Sections are drafted in document order because each task appends to the same file.

**Tech Stack:** Markdown prose. Sources: fiber source corpus at `/home/phill/ckb-wallet/research/fiber-payment-channels/raw/fiber/` (cite as upstream paths, e.g. `crates/fiber-lib/src/rpc/biscuit.rs`), the fiber-route-doctor repo itself, `/home/phill/fiber-exploration/fiber-vs-lightning-research-2026-06-17.md`, and live-smoke outputs.

**Spec:** `docs/superpowers/specs/2026-07-03-gap-analysis-design.md` (each task's claims are copied from it verbatim below — the spec is the tiebreaker on any discrepancy).

## Global Constraints

- Tone: constructive, evidence-first, zero snark. Fiber is early; gaps are normal; this is a prioritized, reproducible map.
- EVERY factual claim carries a proof pointer inline: upstream source path, toolkit file/test, live-smoke quote, or the June research doc. Unverified = say "unverified", never assert.
- Version-scope any behavior that could differ between fnn **v0.7.1** (deployed test node) and **v0.9.0-rc5** (research-corpus source).
- No secrets: no tokens, keys, or key material in any form. No superlatives without numbers.
- Style: prose in complete sentences; tables for enumerable facts; `##` for the 8 top-level sections; repro steps as fenced code blocks.
- Section word targets are ±20%: exec 300, method 250, each gap 450, traps 800, live 300, protocol 300, roadmap 500.
- Facts file: `/home/phill/fiber-hack/.superpowers/sdd/ga-facts.md` (gitignored scratch) — drafting tasks MUST cite numbers from it, never from memory.
- Every task: after drafting, re-read your section checking each pointer resolves; then commit `docs/GAP-ANALYSIS.md` with the given message.

---

### Task 1: Facts file — resolve every open verification item

**Files:**
- Create: `/home/phill/fiber-hack/.superpowers/sdd/ga-facts.md` (NOT committed — gitignored scratch consumed by Tasks 2–7)

**Interfaces:**
- Produces: a facts file with sections `NUMBERS`, `CITATIONS`, `PAGINATION-VERDICT`, `HUBS`, `SMOKE-QUOTES`, `RESEARCH-QUOTES`. Every entry marked `VERIFIED (<how>)` or `UNVERIFIED (<why>)`.

- [ ] **Step 1: Verify the headline numbers**

Run and record outputs in `NUMBERS`:

```bash
cd /home/phill/fiber-hack
npm test 2>&1 | grep -E "Test Files|Tests "        # expect 49 files / 207 tests — record actual
git log --oneline --all --since=2026-06-30 | wc -l  # commit count context
git log --format=%ad --date=short --reverse | head -1  # repo start date (expect 2026-07-01)
ls packages apps                                     # workspace inventory
```

Record: test count, tool count (5), build window (start date → 2026-07-03 = N days), workspaces.

- [ ] **Step 2: Extract source citations**

Read and quote (2–5 lines each, with upstream path + approximate line) into `CITATIONS`:
- `/home/phill/ckb-wallet/research/fiber-payment-channels/raw/fiber/crates/fiber-lib/src/rpc/biscuit.rs` — `build_rules()` entries for `node_info`, `list_channels`, `graph_nodes` (G1/G3 evidence).
- Same corpus, `crates/fiber-lib/src/rpc/middleware.rs` — `auth_reject_error()` = `ErrorObject::owned(-32999, "Unauthorized", ...)` (G3/trap-2 evidence).
- Confirm from the corpus whether any mint/token subcommand exists: `grep -rn "mint" raw/fiber/src raw/fiber/crates/fiber-lib/src/main* 2>/dev/null` and check the fnn CLI arg parsing — record the negative result honestly (searched-and-absent in corpus snapshot; version-scope it).

- [ ] **Step 3: Pagination verdict (spec trap-6 open item)**

```bash
grep -n "graph_nodes\|graph_channels\|limit\|after\|cursor" /home/phill/ckb-wallet/research/fiber-payment-channels/raw/fiber/crates/fiber-lib/src/rpc/graph.rs | head -30
```

Also read the params structs. Record in `PAGINATION-VERDICT` which of the two claims is true: "graph RPCs accept pagination params (name them) but our tooling and obvious call shape don't use them" OR "no pagination params exist in the corpus snapshot".

- [ ] **Step 4: Hub concentration numbers (spec live-observations item)**

Mint a token the same way the smokes do and compute hub stats directly:

```bash
cd /home/phill/fiber-hack && FRD_BISCUIT_KEY=~/.fiber-dt/biscuit_private_key FIBER_RPC_URL=http://127.0.0.1:8231 node --import tsx -e '
import { readFileSync } from "node:fs";
import { importPrivateKeyString, mintToken, scopeFacts } from "./packages/biscuit/src/index.ts";
import { HealthClient, buildNetworkMapModel } from "./packages/core/src/index.ts";
const key = importPrivateKeyString(readFileSync(process.env.FRD_BISCUIT_KEY, "utf8"));
const token = mintToken({ privateKeyString: key.privateKeyString, facts: scopeFacts("readonly"), expiry: new Date(Date.now() + 3600e3) });
const c = new HealthClient({ url: process.env.FIBER_RPC_URL, biscuit: token });
const [nodes, channels] = await Promise.all([c.graphNodes(), c.graphChannels()]);
const m = buildNetworkMapModel(nodes, channels);
const top = m.hubs.slice(0, 3);
const totalCap = BigInt(m.stats.totalCapacity);
const hubShare = m.hubs.reduce((s, h) => s + BigInt(h.totalCapacity), 0n);
console.log(JSON.stringify({ stats: m.stats, top3: top, top10SharePct: Number(hubShare * 100n / (totalCap === 0n ? 1n : totalCap)) / 1 }, null, 2));
'
```

Record node count, channel count, top-3 hubs (pubkey-short + degree + capacity), top-10 capacity share %. NOTE: hub capacity sums count each channel at both endpoints, so top-10 share can exceed 100% of single-counted total — compute and describe honestly (state the denominator convention used).

- [ ] **Step 5: Smoke quotes + research quotes**

- `SMOKE-QUOTES`: copy the exact OK/FAIL lines from the ledger (`/home/phill/fiber-hack/.superpowers/sdd/progress.md`): health verdict FAIL isolated run, liquidity empty-node run, map 214/500 run, biscuit 500-channels run. Include fnn version line `fnn v0.7.1 (…commit…)` from the health smoke.
- `RESEARCH-QUOTES`: from `/home/phill/fiber-exploration/fiber-vs-lightning-research-2026-06-17.md` copy: the bottom-line paragraph, the two shipped advantages, the roadmap list (PTLC/Daric/CCH), and each quote's confidence grading. Preserve the gradings verbatim.

- [ ] **Step 6: Report**

No commit (file is gitignored). The task report lists each facts-file section with VERIFIED/UNVERIFIED status per entry.

---

### Task 2: Document skeleton + Executive summary + Method

**Files:**
- Create: `docs/GAP-ANALYSIS.md`

**Interfaces:**
- Consumes: `ga-facts.md` NUMBERS + SMOKE-QUOTES.
- Produces: the full skeleton (all 8 `##` headers with one-line HTML comments marking owner tasks) so later tasks fill sections in place; drafted §1 Executive summary (~300w) and §2 Method (~250w).

- [ ] **Step 1: Verify pointers (failing-test analog)**

Read `ga-facts.md`. Confirm: test count, tool count, build window, fnn version quote. If any entry is UNVERIFIED, the summary must not state it as fact.

- [ ] **Step 2: Create the skeleton**

`docs/GAP-ANALYSIS.md` starts:

```markdown
# Fiber Infrastructure Gap Analysis & Roadmap

*fiber-route-doctor toolkit — "Gone in 60ms" Fiber Infrastructure Hackathon, July 2026*
*Every claim in this document is backed by working public code, automated tests, or live-testnet output. Unverified statements are marked as such.*

## 1. Executive summary
<!-- task 2 -->

## 2. Method and evidence standards
<!-- task 2 -->

## 3. The five gaps
<!-- tasks 3-4 -->

## 4. Trap catalog: reproducible sharp edges
<!-- task 5 -->

## 5. The live network from one node's vantage
<!-- task 6 -->

## 6. Protocol context: why operator tooling matters now
<!-- task 6 -->

## 7. Consolidated roadmap
<!-- task 7 -->

## 8. Appendix: tool inventory
<!-- task 7 -->
```

- [ ] **Step 3: Draft §1 and §2**

§1 Executive summary (~300w) must contain: the thesis sentence ("fnn works — but the distance between a running binary and an operable network is wide"); the five gaps in one line each (credential lifecycle, payment-failure diagnostics, health/readiness, liquidity observability, topology visibility & bootstrap); the one-sentence evidence standard; the headline numbers FROM THE FACTS FILE (tools, tests, build window, live node/channel counts).

§2 Method (~250w) must contain: five TDD-built tools with test count; live validation against a real testnet node self-reporting **fnn v0.7.1** (quote from facts file); source grounding against the `nervosnetwork/fiber` corpus (state snapshot version range v0.6.1–v0.9.0-rc5 and that claims are version-scoped — the drift is itself a finding, forward-ref §4 trap 3); the June two-pass adversarially-verified research as protocol baseline; the rule that unverifiable claims are marked.

- [ ] **Step 4: Self-fact-check**

Re-read both sections; every number must trace to `ga-facts.md`; no claim without a pointer or forward reference to the section that carries the pointer.

- [ ] **Step 5: Commit**

```bash
git add docs/GAP-ANALYSIS.md
git commit -m "docs(gap-analysis): skeleton, executive summary, method"
```

---

### Task 3: Gaps G1 and G2

**Files:**
- Modify: `docs/GAP-ANALYSIS.md` (§3, first two subsections `### Gap 1 …`, `### Gap 2 …`)

**Interfaces:**
- Consumes: `ga-facts.md` CITATIONS (build_rules quotes, mint-absence verdict) + SMOKE-QUOTES (biscuit 500-channels line).
- Produces: `### Gap 1: Credential lifecycle` and `### Gap 2: Payment-failure diagnostics` (~450w each), each ending with a two-row mini-table `**Upstream ask** / **Toolkit coverage today**`.

- [ ] **Step 1: Verify pointers**

From `ga-facts.md`: the `build_rules` quote and upstream path; the mint-absence verdict (version-scoped); the live smoke quote. From the repo: confirm `packages/biscuit/src/` files exist for the named crypto (keys.ts BIP39/SLIP-0010, keystore.ts scrypt+XChaCha20-Poly1305), and Route Doctor's cause list in `packages/core/src/types.ts` (`ReasonCause` union — cite the actual member count and names, don't say "11" without counting).

- [ ] **Step 2: Draft G1 (~450w)**

Claims (verbatim from spec, each with its pointer):
- fnn mandates biscuit auth on any public RPC listener, verifies via `rpc.biscuit_public_key`, per-method datalog rules in `crates/fiber-lib/src/rpc/biscuit.rs` `build_rules()` (quote 2-3 rule lines from facts file).
- fnn ships no token minting (state the search performed and version scope); `fiber-cli` only consumes tokens.
- What we built: BIP39 mnemonic → SLIP-0010 Ed25519 (`m/44'/1'/0'`) → biscuit mint with scoped facts (`readonly`/`invoicing`/`full`); scrypt(N=2^15)+XChaCha20-Poly1305 keystore, 0600 atomic writes.
- Live proof: quote the smoke line (minted readonly token → authenticated → `graph_channels` returned 500 channels).
- Mini-table: Upstream ask = `fnn token mint/inspect` + documented scope templates; Toolkit today = `keys` / `token` commands.

- [ ] **Step 3: Draft G2 (~450w)**

Claims:
- `send_payment` failures are opaque; the nearest primitive is `build_router` (no dry-run/explain RPC in corpus snapshot — version-scope).
- Fee-scale trap: channel `fee_rate` is ppm (/1,000,000); payment `max_fee_rate` ceiling is per-thousand (/1,000) — two scales on one API surface (pointer: Route Doctor implementation `packages/core/src/` fee handling + spec doc note; also forward-ref §4 trap 4).
- What we built: constrained least-fee pathfinder over `graph_nodes`/`graph_channels` with ranked failure attribution (list the actual `ReasonCause` members from Step 1), optional `build_router` cross-check.
- Mini-table: Upstream ask = dry-run/route-explain RPC returning structured causes; Toolkit today = `diagnose`.

- [ ] **Step 4: Self-fact-check, then commit**

```bash
git add docs/GAP-ANALYSIS.md
git commit -m "docs(gap-analysis): gaps G1 credential lifecycle, G2 failure diagnostics"
```

---

### Task 4: Gaps G3, G4, G5

**Files:**
- Modify: `docs/GAP-ANALYSIS.md` (§3, subsections `### Gap 3 …` through `### Gap 5 …`)

**Interfaces:**
- Consumes: `ga-facts.md` CITATIONS (-32999 quote), SMOKE-QUOTES (health FAIL isolated; liquidity empty; map 214/500), HUBS.
- Produces: three ~450w subsections, same shape as Task 3 (claims → evidence → live proof → mini-table).

- [ ] **Step 1: Verify pointers**

From `ga-facts.md`: `auth_reject_error` quote; health/liquidity/map smoke lines. From the repo: health probe check ids (`packages/core/src/health-checks.ts`), liquidity report fields (`packages/core/src/liquidity-types.ts`), map model semantics (`packages/core/src/network-map.ts`).

- [ ] **Step 2: Draft G3 Health & readiness (~450w)**

Claims: no health/readiness endpoint — operators synthesize from `node_info`/`list_peers`/`list_channels`; auth rejection is JSON-RPC `-32999 "Unauthorized"` over HTTP 200 (`crates/fiber-lib/src/rpc/middleware.rs`, quote), undocumented; reverse-proxied nodes return HTTP 401/403 instead, so naive clients report "node down" for an auth problem. Our probe: five checks (reachability, auth, node-info, peers, channels) with pass/warn/fail + fix hints, exit codes 0/1/2, `--watch` with edge-triggered webhooks. Live proof: the FAIL-isolated verdict quote — a true positive. Mini-table: Upstream ask = health RPC + documented auth-error contract; Toolkit = `health`.

- [ ] **Step 3: Draft G4 Liquidity observability (~450w)**

Claims: `list_channels` is raw per-channel state — no aggregates (total sendable/receivable, largest single payment) and no history; balance-vs-TLC-hold semantics undocumented. Our tool: per-asset totals over ready+enabled channels, skew flags (drained <10% / full >90% local), in-flight holds, per-peer groups; raw-first persisted snapshots with `--diff`. Live proof: empty-node quote (honest zero-channel path). Mini-table: Upstream ask = documented balance semantics + optional aggregate RPC; Toolkit = `liquidity --save/--diff`.

- [ ] **Step 4: Draft G5 Topology visibility & bootstrap (~450w)**

Claims: gossip persists while a node is isolated — our node reported ~500 gossiped channels with 0 peers ("the network looks fine" while nothing can route); no isolation warning; bootstrap is manual `connect_peer` with no documented starter peers; gossiped-graph vs own-channels is the #1 new-operator confusion (forward-ref §4 trap 5). Our tools: the map rendered the live topology (numbers from HUBS) *from an isolated node*; the health probe flags isolation explicitly. Mini-table: Upstream ask = isolation warnings in logs/`node_info` + documented bootstrap peers; Toolkit = `map` + `health`.

- [ ] **Step 5: Self-fact-check, then commit**

```bash
git add docs/GAP-ANALYSIS.md
git commit -m "docs(gap-analysis): gaps G3 health, G4 liquidity, G5 topology"
```

---

### Task 5: Trap catalog

**Files:**
- Modify: `docs/GAP-ANALYSIS.md` (§4)

**Interfaces:**
- Consumes: `ga-facts.md` CITATIONS, PAGINATION-VERDICT, SMOKE-QUOTES.
- Produces: §4 (~800w): an index table (trap / symptom / affected layer) followed by one `###` subsection per trap with repro steps in fenced blocks.

- [ ] **Step 1: Verify pointers**

Every repro command below must be checked for plausibility against the repo (script names exist, flags exist). The pagination trap MUST match `PAGINATION-VERDICT` exactly.

- [ ] **Step 2: Draft the seven traps**

1. **IPv4-only bind vs `localhost`** — fnn binds `0.0.0.0` (IPv4); modern Node fetch tries `::1` first → "fetch failed" while the node is up. Repro block: run any smoke with `FIBER_RPC_URL=http://localhost:8231` (fails) vs `http://127.0.0.1:8231` (works). Fix guidance: always use `127.0.0.1` or bind dual-stack.
2. **`-32999` over HTTP 200** — auth rejection is a JSON-RPC error, not an HTTP status (quote); behind a reverse proxy it becomes HTTP 401/403; clients must classify BOTH as auth (not transport). Repro: `curl -X POST http://127.0.0.1:8231 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"node_info","params":[]}'` → 200 + `-32999`.
3. **Version drift** — deployed binary self-reports v0.7.1; current public source is v0.9.0-rc5; docs/research written against source can mislead operators of deployed nodes. Repro: `node_info.version` via the health probe.
4. **Two fee scales** — ppm vs per-thousand (as G2; give the concrete divisor pair and one worked example with numbers).
5. **Gossiped graph ≠ your channels** — `graph_channels` (network gossip, may include retained data) vs `list_channels` (own channels); 500 vs 0 on the same node. Repro: run `map --json` (stats) vs `liquidity` (own) against the same node.
6. **Graph pagination** — write EXACTLY per PAGINATION-VERDICT (either "no pagination in corpus snapshot — full-graph fetch is the only shape" or "params X/Y exist but are undocumented/unused by obvious call shapes"). Note growth risk either way.
7. **Ecosystem: biscuit-wasm run-limit** — default ~1ms datalog `max_time` throws `{"RunLimit":"Timeout"}` under CPU contention; a naive catch reports a VALID token as denied; the `RunLimits` serde field is flat `max_time_micro` — a `{secs,nanos}` shape is SILENTLY ignored (false-green fix). Fix pattern: `authorizeWithLimits({max_time_micro: …})` + rethrow run-limit errors (fail closed, never "denied"). Pointer: `packages/biscuit/src/authorize.ts` + its history.

- [ ] **Step 3: Self-fact-check, then commit**

```bash
git add docs/GAP-ANALYSIS.md
git commit -m "docs(gap-analysis): reproducible trap catalog"
```

---

### Task 6: Live network observations + Protocol context

**Files:**
- Modify: `docs/GAP-ANALYSIS.md` (§5, §6)

**Interfaces:**
- Consumes: `ga-facts.md` HUBS (exact numbers + denominator convention note), RESEARCH-QUOTES (with confidence gradings).
- Produces: §5 (~300w) and §6 (~300w).

- [ ] **Step 1: Verify pointers**

HUBS numbers present and marked VERIFIED; research quotes carry their original confidence gradings.

- [ ] **Step 2: Draft §5 (~300w)**

The testnet from driveThree's vantage (date-stamped): node count, channel count, top-3 hubs (shortened pubkeys/names, degree, capacity), top-10 capacity share (state the denominator convention honestly per facts file). The isolation experience: what a fresh operator sees; our own health verdict caught it. One inference, clearly labeled as inference: hub concentration + silent isolation → network-health tooling is not optional.

- [ ] **Step 3: Draft §6 (~300w)**

Cited entirely from the June research (preserve gradings; do not upgrade abstained claims): Fiber's shipped form is a faithful Lightning re-implementation on CKB (Sphinx onion, BOLT-7-style gossip, Dijkstra-variant pathfinding, HTLCs); genuine shipped advantages are native multi-asset channels and programmable settlement; PTLC, Daric O(1) watchtower, generalized CCH remain roadmap. Closing inference (labeled): with protocol differentiation still landing, operational maturity is the near-term differentiator — exactly where §3's gaps sit.

- [ ] **Step 4: Self-fact-check, then commit**

```bash
git add docs/GAP-ANALYSIS.md
git commit -m "docs(gap-analysis): live network observations and protocol context"
```

---

### Task 7: Roadmap, appendix, README link

**Files:**
- Modify: `docs/GAP-ANALYSIS.md` (§7, §8)
- Modify: `README.md` (add one link line)

**Interfaces:**
- Consumes: everything prior in the doc (must be consistent with it — this task reads the whole file); `ga-facts.md` NUMBERS.
- Produces: §7 two tables, §8 inventory table, README link.

- [ ] **Step 1: Draft §7 (~500w)**

**Upstream asks (prioritized)** — table with columns Priority / Ask / Gap or trap it closes / Effort guess (S/M/L): 1 token mint subcommand (G1); 2 health RPC + auth-error docs (G3, trap 2); 3 dry-run/route-explain (G2); 4 fee-scale docs unification (G2, trap 4); 5 isolation warnings + bootstrap docs (G5); 6 balance-semantics docs (G4); 7 graph pagination per trap 6's verdict. One short paragraph on sequencing rationale.

**Toolkit roadmap** — table: Tier B in-browser keystore GUI (IndexedDB + WASM crypto); fleet view (multi-node health/liquidity); snapshot trend history; map time-series; webhook alerting expansion; recorded polish backlog. One paragraph noting all five current tools are shipped, tested, live-validated.

- [ ] **Step 2: Draft §8 appendix**

Table, one row per tool: Tool / One-line purpose / CLI entry / Live proof (one line, from smoke quotes) / Source dir. Numbers (tests total) from facts file. End with repo link and MIT license note.

- [ ] **Step 3: README link**

In `README.md`, after the opening description paragraph, add:

```markdown
**📋 Read the full [Fiber Infrastructure Gap Analysis & Roadmap](docs/GAP-ANALYSIS.md)** — every gap backed by a working tool and live-testnet proof.
```

- [ ] **Step 4: Whole-doc consistency pass**

Read `docs/GAP-ANALYSIS.md` end-to-end: section numbers match the skeleton; forward references resolve; word count within ±20% of 4,500 (`wc -w docs/GAP-ANALYSIS.md`); no `<!-- task N -->` comments remain; no "TBD".

- [ ] **Step 5: Commit**

```bash
git add docs/GAP-ANALYSIS.md README.md
git commit -m "docs(gap-analysis): roadmap, tool inventory appendix, README link"
```

---

## Verification checklist (post-plan)

- Final fable whole-doc review (handled by the SDD pipeline): coherence, accuracy vs facts file, tone, length; fix wave; then push and confirm the README link renders on GitHub.
- Spot-check three random claims end-to-end (pointer → source) as part of the final review dispatch.
