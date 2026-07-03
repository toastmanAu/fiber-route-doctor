export type Command = "diagnose" | "keys" | "token" | "health" | "liquidity" | "map";
const COMMANDS: Command[] = ["diagnose", "keys", "token", "health", "liquidity", "map"];

export function parseCommand(argv: string[]): { command: Command; rest: string[] } {
  const first = argv[0];
  if (first === undefined || first.startsWith("--")) return { command: "diagnose", rest: argv };
  if ((COMMANDS as string[]).includes(first)) return { command: first as Command, rest: argv.slice(1) };
  throw new Error(`unknown command '${first}' (expected: ${COMMANDS.join(", ")})`);
}
