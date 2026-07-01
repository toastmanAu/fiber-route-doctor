# Running a Fiber v0.9 testnet node for the demo

Route Doctor reads a node's gossip graph over JSON-RPC. Any reachable Fiber
v0.9 node works; read-only `graph_nodes` / `graph_channels` also work against
public testnet nodes.

## Option A: official Docker image (v0.8.1+)
```
docker run --rm -p 8227:8227 \
  -v "$PWD/fiber-data:/data" \
  nervos/fiber:latest --config /data/config.yml
```
Point Route Doctor at `http://127.0.0.1:8227`.

## Option B: public testnet node
Set `FIBER_RPC_URL` to a public node's RPC endpoint (graph queries are
unauthenticated). `build_router` may require your own node.

## Verifying
```
FIBER_RPC_URL=http://127.0.0.1:8227 npm run smoke:live
```
