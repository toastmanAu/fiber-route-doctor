export type ScopeTemplate = "readonly" | "invoicing" | "operator" | "full";

const READONLY = [
  'read("node")', 'read("peers")', 'read("channels")',
  'read("payments")', 'read("graph")', 'read("cch")'
];

export function scopeFacts(scope: ScopeTemplate, extra: string[] = []): string[] {
  switch (scope) {
    case "readonly": return [...READONLY, ...extra];
    case "invoicing": return [...READONLY, 'write("invoices")', ...extra];
    // channel lifecycle management: open/update/close (channels) + connect (peers)
    case "operator": return [...READONLY, 'write("channels")', 'write("peers")', ...extra];
    case "full": return [...READONLY, 'write("channels")', 'write("cch")', 'write("invoices")', 'write("peers")', 'write("payments")', ...extra];
  }
}
