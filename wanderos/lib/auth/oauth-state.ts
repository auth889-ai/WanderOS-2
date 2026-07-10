import { createHmac, timingSafeEqual } from "node:crypto";
import { isRole, Role } from "./roles";

type OAuthStatePayload = {
  role: Role;
  exp: number;
};

type VerifiedOAuthStatePayload = {
  role: Exclude<Role, "admin">;
  exp: number;
};

function getSecret() {
  return process.env.AUTH_SECRET || process.env.JWT_SECRET || "wanderos-local-dev-secret-change-me";
}

function sign(value: string) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

export function createOAuthState(role: Exclude<Role, "admin"> = "traveler") {
  const payload: OAuthStatePayload = {
    role,
    exp: Math.floor(Date.now() / 1000) + 10 * 60
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyOAuthState(state = ""): VerifiedOAuthStatePayload | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) {
    return null;
  }

  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
    if (!isRole(payload.role) || payload.role === "admin" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return {
      role: payload.role,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}
