import { NextRequest, NextResponse } from "next/server";
import { isRole, roleCookieName, roleHome, Role, userCookieName } from "@/lib/auth/roles";
import { createSessionToken, sessionCookieName } from "@/lib/auth/token";

const demoUsers: Record<Role, { id: string; name: string; email: string; role: Role }> = {
  traveler: {
    id: "traveler_demo_001",
    name: "Ava Traveler",
    email: "traveler@wanderos.dev",
    role: "traveler"
  },
  host: {
    id: "host_demo_001",
    name: "Nadia Host",
    email: "host@wanderos.dev",
    role: "host"
  },
  admin: {
    id: "admin_demo_001",
    name: "Travel Admin",
    email: "admin@wanderos.dev",
    role: "admin"
  }
};

export function GET(request: NextRequest) {
  const role = request.nextUrl.searchParams.get("role");

  if (!isRole(role)) {
    return NextResponse.json({ error: "Unknown demo role." }, { status: 400 });
  }

  const requestedNext = request.nextUrl.searchParams.get("next");
  const redirectPath = requestedNext && requestedNext.startsWith("/") ? requestedNext : roleHome[role];
  const response = NextResponse.redirect(new URL(redirectPath, request.url));
  const maxAge = 60 * 60 * 24 * 7;
  const token = createSessionToken(demoUsers[role], maxAge);

  response.cookies.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
  response.cookies.set(roleCookieName, role, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
  response.cookies.set(userCookieName, JSON.stringify(demoUsers[role]), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  });

  return response;
}
