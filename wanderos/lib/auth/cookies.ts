import { NextResponse } from "next/server";
import { roleCookieName, SessionUser } from "./roles";
import { createSessionToken, sessionCookieName } from "./token";

export function setAuthCookies(response: NextResponse, user: SessionUser) {
  const maxAge = 60 * 60 * 24 * 7;
  const token = createSessionToken(user, maxAge);

  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
  response.cookies.set(roleCookieName, user.role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
}
