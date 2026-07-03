import type { Hex } from "./types.js";

export interface MapNode {
  pubkey: Hex;
  name: string | null;
  degree: number;
  totalCapacity: string; // decimal string, bigint-safe
  isolated: boolean;
  isOwn: boolean;
}
export interface MapEdge {
  outpoint: Hex;
  a: Hex;
  b: Hex;
  capacity: string;
  disabled: boolean; // no enabled direction
}
export interface HubEntry { pubkey: Hex; name: string | null; degree: number; totalCapacity: string; }
export interface NetworkMapModel {
  nodes: MapNode[];
  edges: MapEdge[];
  hubs: HubEntry[];
  stats: { nodeCount: number; channelCount: number; totalCapacity: string };
}
export interface LayoutPoint { x: number; y: number; }
