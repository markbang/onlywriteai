import { Hono } from "hono";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createAuthConfig, createAuthRuntime, type AuthConfig } from "./auth.ts";

const encoder = new TextEncoder();

function base64UrlEncode(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string" ? encoder.encode(value) : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

async function createSignedJwt(payload: Record<string, unknown>) {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );

  return {
    jwk: { ...publicJwk, alg: "RS256", kid: "test-key", use: "sig" },
    token: `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`,
  };
}

function createTestConfig(overrides: Record<string, string> = {}): AuthConfig {
  return createAuthConfig({
    APP_BASE_URL: "http://localhost:5173",
    AUTH_SESSION_SECRET: "test-session-secret",
    LOGTO_APP_ID: "app-id",
    LOGTO_APP_SECRET: "app-secret",
    LOGTO_ISSUER: "https://auth.example.test/oidc",
    LOGTO_JWKS_URI: "https://auth.example.test/oidc/jwks",
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("requests profile and email scopes by default", async () => {
  const auth = createAuthRuntime(createTestConfig());
  const app = new Hono();
  app.get("/auth/login", (c) => auth.createLoginResponse(c));

  const response = await app.request("/auth/login");
  const location = response.headers.get("location");

  expect(response.status).toBe(302);
  expect(new URL(location ?? "").searchParams.get("scope")).toBe("openid profile email");
});

test("uses Logto userinfo picture when creating the session", async () => {
  const config = createTestConfig();
  const auth = createAuthRuntime(config);
  const app = new Hono();
  app.get("/auth/login", (c) => auth.createLoginResponse(c));
  app.get("/auth/callback", (c) => auth.handleCallback(c));
  app.get("/auth/me", async (c) => c.json({ user: await auth.readUser(c) }));
  const { jwk, token } = await createSignedJwt({
    aud: "app-id",
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: "https://auth.example.test/oidc",
    name: "ID Token Name",
    picture: "https://example.test/id-token.png",
    sub: "user-1",
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://auth.example.test/oidc/token") {
        return Response.json({ access_token: "access-token", id_token: token });
      }
      if (url === "https://auth.example.test/oidc/jwks") {
        return Response.json({ keys: [jwk] });
      }
      if (url === "https://auth.example.test/oidc/me") {
        return Response.json({
          email: "me@example.test",
          name: "Userinfo Name",
          picture: "https://example.test/userinfo.png",
          sub: "user-1",
        });
      }

      return new Response(null, { status: 404 });
    }),
  );

  const loginResponse = await app.request("/auth/login");
  const loginUrl = new URL(loginResponse.headers.get("location") ?? "");
  const callbackResponse = await app.request(
    `/auth/callback?code=test-code&state=${loginUrl.searchParams.get("state")}`,
    {
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    },
  );
  const sessionCookie = /ow_session=([^;]+)/.exec(
    callbackResponse.headers.get("set-cookie") ?? "",
  )?.[1];
  const meResponse = await app.request("/auth/me", {
    headers: { cookie: `ow_session=${sessionCookie}` },
  });

  expect(callbackResponse.status).toBe(302);
  await expect(meResponse.json()).resolves.toEqual({
    user: {
      email: "me@example.test",
      name: "Userinfo Name",
      picture: "https://example.test/userinfo.png",
      sub: "user-1",
    },
  });
});

test("uses application session max age instead of ID token lifetime", async () => {
  const config = createTestConfig({ AUTH_SESSION_MAX_AGE_SECONDS: "2592000" });
  const auth = createAuthRuntime(config);
  const app = new Hono();
  app.get("/auth/login", (c) => auth.createLoginResponse(c));
  app.get("/auth/callback", (c) => auth.handleCallback(c));
  const { jwk, token } = await createSignedJwt({
    aud: "app-id",
    exp: Math.floor(Date.now() / 1000) + 600,
    iss: "https://auth.example.test/oidc",
    sub: "user-1",
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === "https://auth.example.test/oidc/token") {
        return Response.json({ id_token: token });
      }
      if (url === "https://auth.example.test/oidc/jwks") {
        return Response.json({ keys: [jwk] });
      }

      return new Response(null, { status: 404 });
    }),
  );

  const loginResponse = await app.request("/auth/login");
  const loginUrl = new URL(loginResponse.headers.get("location") ?? "");
  const callbackResponse = await app.request(
    `/auth/callback?code=test-code&state=${loginUrl.searchParams.get("state")}`,
    {
      headers: { cookie: loginResponse.headers.get("set-cookie") ?? "" },
    },
  );
  const setCookie = callbackResponse.headers.get("set-cookie") ?? "";

  expect(callbackResponse.status).toBe(302);
  expect(setCookie).toContain("ow_session=");
  expect(setCookie).toContain("Max-Age=2592000");
});
