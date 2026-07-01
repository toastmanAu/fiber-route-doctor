export type ScopeTemplate = "readonly" | "invoicing" | "full";

const READONLY = [
  'read("node")', 'read("peers")', 'read("channels")',
  'read("payments")', 'read("graph")', 'read("cch")'
];

export function scopeFacts(scope: ScopeTemplate, extra: string[] = []): string[] {
  switch (scope) {
    case "readonly": return [...READONLY, ...extra];
    case "invoicing": return [...READONLY, 'write("invoices")', ...extra];
    case "full": return [...READONLY, 'write("channels")', 'write("cch")', 'write("invoices")', ...extra];
  }
}
