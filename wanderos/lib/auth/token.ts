import { createHmac, timingSafeEqual } from "node:crypto";
import { Role } from "./roles";

export const sessionCookieName = "wanderos_session";

type SessionPayload = {
  id: string;
  name: string;
  email: string;
  role: Role;
  exp: number;
};

function getSecret() {
  return process.env.AUTH_SECRET || process.env.JWT_SECRET || "wanderos-local-dev-secret-change-me";
}

function base64url(input: string | Buffer) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createSessionToken(payload: Omit<SessionPayload, "exp">, maxAgeSeconds = 60 * 60 * 24 * 7) {
  const body: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds
  };
  const encoded = base64url(JSON.stringify(body));
  const signature = sign(encoded);

  return `${encoded}.${signature}`;
}

export function verifySessionToken(token = ""): SessionPayload | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.id || !payload.email || !payload.name || !payload.role || !payload.exp) {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
