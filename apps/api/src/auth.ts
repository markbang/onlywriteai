import { getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";

type JwtHeader = {
  alg?: string;
  kid?: string;
  typ?: string;
};

type Jwk = {
  alg?: string;
  crv?: string;
  e?: string;
  ext?: boolean;
  key_ops?: string[];
  kid?: string;
  kty?: string;
  n?: string;
  x?: string;
  y?: string;
  use?: string;
};

type JwksResponse = {
  keys?: Jwk[];
};

type TokenResponse = {
  access_token?: unknown;
  id_token?: unknown;
};

export type AuthUser = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

type AuthSession = {
  user: AuthUser;
  expiresAt: number;
};

export type AuthConfig = {
  appBaseUrl: string;
  clientId: string;
  clientSecret: string;
  enabled: boolean;
  issuer: string;
  jwksUri: string;
  redirectUri: string;
  scopes: string;
  sessionMaxAgeSeconds: number;
  sessionSecret: string;
};

export type AuthRuntime = {
  config: AuthConfig;
  createLoginResponse(c: Context): Promise<Response>;
  handleCallback(c: Context): Promise<Response>;
  handleLogout(c: Context): Response;
  readUser(c: Context): Promise<AuthUser | null>;
  requireAuth: MiddlewareHandler;
  updateSessionUser(c: Context, user: AuthUser): Promise<void>;
};

const sessionCookie = "ow_session";
const oauthCookie = "ow_oauth";
const encoder = new TextEncoder();
const defaultSessionMaxAgeSeconds = 60 * 60 * 24 * 30;
let jwksCache: { expiresAt: number; jwksUri: string; keys: Jwk[] } | null = null;

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

export function createAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const issuer = trimTrailingSlash(env.LOGTO_ISSUER ?? "https://auth.bangwu.me/oidc");
  const appBaseUrl = trimTrailingSlash(env.APP_BASE_URL ?? "http://localhost:5173");
  const clientId = env.LOGTO_APP_ID ?? "";
  const clientSecret = env.LOGTO_APP_SECRET ?? "";
  const sessionSecret = env.AUTH_SESSION_SECRET ?? clientSecret;
  const sessionMaxAgeSeconds = readPositiveInteger(
    env.AUTH_SESSION_MAX_AGE_SECONDS,
    defaultSessionMaxAgeSeconds,
  );

  return {
    appBaseUrl,
    clientId,
    clientSecret,
    enabled: Boolean(clientId && clientSecret && sessionSecret),
    issuer,
    jwksUri: env.LOGTO_JWKS_URI ?? `${issuer}/jwks`,
    redirectUri: env.LOGTO_REDIRECT_URI ?? `${appBaseUrl}/api/auth/callback`,
    scopes: env.LOGTO_SCOPES ?? "openid profile email",
    sessionMaxAgeSeconds,
    sessionSecret,
  };
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function randomValue() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string) {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

async function signValue(value: string, secret: string) {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return `${value}.${base64UrlEncode(signature)}`;
}

async function verifySignedValue(value: string | undefined, secret: string) {
  if (!value) {
    return null;
  }

  const index = value.lastIndexOf(".");
  if (index < 0) {
    return null;
  }

  const payload = value.slice(0, index);
  const signature = base64UrlDecode(value.slice(index + 1));
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, signature, encoder.encode(payload));
  return valid ? payload : null;
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function fetchJwks(config: AuthConfig, force = false) {
  if (!force && jwksCache?.jwksUri === config.jwksUri && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }

  const response = await fetch(config.jwksUri);
  if (!response.ok) {
    throw new Error(`Could not load JWKS: ${response.status}`);
  }

  const body = (await response.json()) as JwksResponse;
  jwksCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    jwksUri: config.jwksUri,
    keys: body.keys ?? [],
  };
  return jwksCache.keys;
}

function parseJwt(token: string) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error("Invalid JWT");
  }

  return {
    encodedHeader,
    encodedPayload,
    encodedSignature,
    header: parseJson<JwtHeader>(base64UrlDecode(encodedHeader).toString("utf8")),
    payload: parseJson<Record<string, unknown>>(base64UrlDecode(encodedPayload).toString("utf8")),
  };
}

function readStringClaim(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function toUser(payload: Record<string, unknown>): AuthUser {
  return {
    sub: readStringClaim(payload, "sub") ?? "",
    email: readStringClaim(payload, "email"),
    name: readStringClaim(payload, "name", "username"),
    picture: readStringClaim(payload, "picture", "avatar", "avatar_url"),
  };
}

function mergeUser(base: AuthUser, profile: AuthUser | null): AuthUser {
  if (!profile || profile.sub !== base.sub) {
    return base;
  }

  return {
    sub: base.sub,
    email: profile.email ?? base.email,
    name: profile.name ?? base.name,
    picture: profile.picture ?? base.picture,
  };
}

async function fetchUserInfo(accessToken: string, config: AuthConfig) {
  const response = await fetch(config.issuer + "/me", {
    headers: { authorization: "Bearer " + accessToken },
  });
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as unknown;
  return body && typeof body === "object" ? toUser(body as Record<string, unknown>) : null;
}

async function verifyJwt(token: string, config: AuthConfig) {
  const parsed = parseJwt(token);
  if (!parsed.header || !parsed.payload) {
    throw new Error("Invalid JWT payload");
  }

  let jwk = (await fetchJwks(config)).find((key) => key.kid === parsed.header?.kid);
  if (!jwk) {
    jwk = (await fetchJwks(config, true)).find((key) => key.kid === parsed.header?.kid);
  }
  if (!jwk) {
    throw new Error("JWT key not found");
  }

  const signedContent = encoder.encode(`${parsed.encodedHeader}.${parsed.encodedPayload}`);
  const signature = base64UrlDecode(parsed.encodedSignature);
  let valid = await verifyJwtSignature(parsed.header, jwk, signature, signedContent);
  if (!valid) {
    const refreshedJwk = (await fetchJwks(config, true)).find(
      (key) => key.kid === parsed.header?.kid,
    );
    if (refreshedJwk && refreshedJwk !== jwk) {
      valid = await verifyJwtSignature(parsed.header, refreshedJwk, signature, signedContent);
    }
  }

  if (!valid) {
    throw new Error(
      parsed.header.alg === "RS256" || parsed.header.alg === "ES384"
        ? "Invalid JWT signature"
        : `Unsupported JWT algorithm: ${parsed.header.alg ?? "unknown"}`,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const issuer = parsed.payload.iss;
  const expiresAt = parsed.payload.exp;
  const notBefore = parsed.payload.nbf;
  const audience = parsed.payload.aud;
  const audienceValues = Array.isArray(audience) ? audience : [audience];

  if (issuer !== config.issuer) {
    throw new Error("Invalid JWT issuer");
  }
  if (typeof expiresAt !== "number" || expiresAt <= now) {
    throw new Error("JWT expired");
  }
  if (typeof notBefore === "number" && notBefore > now) {
    throw new Error("JWT not active");
  }
  if (!audienceValues.includes(config.clientId)) {
    throw new Error("Invalid JWT audience");
  }

  const user = toUser(parsed.payload);
  if (!user.sub) {
    throw new Error("JWT missing subject");
  }

  return { expiresAt: expiresAt * 1000, user };
}

async function verifyJwtSignature(
  header: JwtHeader,
  jwk: Jwk,
  signature: Buffer,
  signedContent: Uint8Array,
) {
  if (header.alg === "RS256") {
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
        false,
        ["verify"],
      ),
      signature,
      signedContent,
    );
  }

  if (header.alg === "ES384") {
    return crypto.subtle.verify(
      { hash: "SHA-384", name: "ECDSA" },
      await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-384" }, false, [
        "verify",
      ]),
      signature,
      signedContent,
    );
  }

  return false;
}

function setAuthCookie(c: Context, name: string, value: string, maxAge: number) {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = c.req.url.startsWith("https://") || forwardedProto === "https";

  setCookie(c, name, value, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax",
    secure,
  });
}

function clearAuthCookie(c: Context, name: string) {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = c.req.url.startsWith("https://") || forwardedProto === "https";

  setCookie(c, name, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure,
  });
}

export function createAuthRuntime(config: AuthConfig): AuthRuntime {
  async function createSession(session: AuthSession) {
    return signValue(base64UrlEncode(JSON.stringify(session)), config.sessionSecret);
  }

  async function readSession(c: Context) {
    const payload = await verifySignedValue(getCookie(c, sessionCookie), config.sessionSecret);
    if (!payload) {
      return null;
    }

    const session = parseJson<AuthSession>(base64UrlDecode(payload).toString("utf8"));
    if (!session || session.expiresAt <= Date.now() || !session.user?.sub) {
      return null;
    }

    return session;
  }

  async function readBearerUser(c: Context) {
    const authorization = c.req.header("authorization");
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (!match) {
      return null;
    }

    return (await verifyJwt(match[1], config)).user;
  }

  async function readUser(c: Context) {
    if (!config.enabled) {
      return null;
    }

    const session = await readSession(c);
    if (session) {
      return session.user;
    }

    return readBearerUser(c).catch(() => null);
  }

  return {
    config,

    async createLoginResponse(c) {
      if (!config.enabled) {
        return c.redirect("/");
      }

      const state = randomValue();
      const codeVerifier = randomValue();
      const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
      const oauthState = await signValue(
        base64UrlEncode(JSON.stringify({ codeVerifier, state })),
        config.sessionSecret,
      );
      setAuthCookie(c, oauthCookie, oauthState, 10 * 60);

      const authorizationUrl = new URL(`${config.issuer}/auth`);
      authorizationUrl.searchParams.set("client_id", config.clientId);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", config.scopes);
      authorizationUrl.searchParams.set("state", state);

      return c.redirect(authorizationUrl.toString());
    },

    async handleCallback(c) {
      if (!config.enabled) {
        return c.redirect("/");
      }

      const error = c.req.query("error");
      const errorDescription = c.req.query("error_description");
      if (error) {
        return c.json({ error: { message: errorDescription ?? error } }, 400);
      }

      const code = c.req.query("code");
      const state = c.req.query("state");
      const oauthPayload = await verifySignedValue(getCookie(c, oauthCookie), config.sessionSecret);
      clearAuthCookie(c, oauthCookie);
      const oauthState = oauthPayload
        ? parseJson<{ codeVerifier: string; state: string }>(
            base64UrlDecode(oauthPayload).toString("utf8"),
          )
        : null;
      if (!code || !state || !oauthState || oauthState.state !== state) {
        return c.json({ error: { message: "Invalid auth callback" } }, 400);
      }

      const tokenResponse = await fetch(`${config.issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          code_verifier: oauthState.codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: config.redirectUri,
        }),
      });
      if (!tokenResponse.ok) {
        return c.json({ error: { message: "Could not complete login" } }, 502);
      }

      const tokenBody = (await tokenResponse.json()) as TokenResponse;
      if (typeof tokenBody.id_token !== "string") {
        return c.json({ error: { message: "Login response did not include an ID token" } }, 502);
      }

      let verified: Awaited<ReturnType<typeof verifyJwt>>;
      try {
        verified = await verifyJwt(tokenBody.id_token, config);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not verify login token";
        return c.json({ error: { message } }, 502);
      }

      const profile =
        typeof tokenBody.access_token === "string"
          ? await fetchUserInfo(tokenBody.access_token, config)
          : null;

      setAuthCookie(
        c,
        sessionCookie,
        await createSession({
          user: mergeUser(verified.user, profile),
          expiresAt: Date.now() + config.sessionMaxAgeSeconds * 1000,
        }),
        config.sessionMaxAgeSeconds,
      );

      return c.redirect("/");
    },

    handleLogout(c) {
      clearAuthCookie(c, sessionCookie);
      clearAuthCookie(c, oauthCookie);
      return c.body(null, 204);
    },

    readUser,

    async updateSessionUser(c, user) {
      const session = await readSession(c);
      if (!session) {
        return;
      }

      setAuthCookie(
        c,
        sessionCookie,
        await createSession({ user, expiresAt: session.expiresAt }),
        Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
      );
    },

    async requireAuth(c, next) {
      if (!config.enabled) {
        await next();
        return;
      }

      const user = await readUser(c);
      if (!user) {
        return c.json({ error: { message: "Unauthorized" } }, 401);
      }

      c.set("user", user);
      await next();
    },
  };
}
