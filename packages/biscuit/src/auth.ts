export interface AuthResolveOptions {
  profile?: string;
  authToken?: string;
  authTokenFile?: string;
  env?: Record<string, string | undefined>;
  getProfileToken?: (name: string) => string | undefined;
  readFile?: (path: string) => string;
}

export function resolveToken(o: AuthResolveOptions): string | undefined {
  if (o.authToken) return o.authToken.trim();
  if (o.authTokenFile && o.readFile) return o.readFile(o.authTokenFile).trim();
  if (o.profile && o.getProfileToken) {
    const t = o.getProfileToken(o.profile);
    if (t) return t.trim();
  }
  const envTok = (o.env ?? {})["FNN_AUTH_TOKEN"];
  return envTok ? envTok.trim() : undefined;
}
