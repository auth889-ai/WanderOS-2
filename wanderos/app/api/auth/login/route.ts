import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { verifyPassword } from "@/lib/auth/password";
import { roleHome } from "@/lib/auth/roles";
import { findUserByEmail } from "@/lib/db/tables/users";

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json");
}

async function readBody(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json().catch(() => ({}));
  }

  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(request: NextRequest) {
  const body = await readBody(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const next = String(body.next || "");

  const user = await findUserByEmail(email);
  const valid = Boolean(user?.password_hash && verifyPassword(password, user.password_hash));

  if (!user || !valid || user.status !== "active") {
    const error = "Invalid email or password.";
    if (wantsJson(request)) {
      return NextResponse.json({ error }, { status: 401 });
    }
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }

  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
  const redirectPath = next.startsWith("/") ? next : roleHome[user.role];
  const response = wantsJson(request)
    ? NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } })
    : NextResponse.redirect(new URL(redirectPath, request.url));

  setAuthCookies(response, sessionUser);

  return response;
}
