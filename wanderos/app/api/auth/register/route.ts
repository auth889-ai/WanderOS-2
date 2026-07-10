import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { hashPassword } from "@/lib/auth/password";
import { isRole, roleHome } from "@/lib/auth/roles";
import { createUser, findUserByEmail } from "@/lib/db/tables/users";

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
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const requestedRole = String(body.role || "traveler");
  const role = isRole(requestedRole) && requestedRole !== "admin" ? requestedRole : "traveler";

  if (!name || !email || password.length < 8) {
    const error = "Name, email, and an 8+ character password are required.";
    if (wantsJson(request)) {
      return NextResponse.json({ error }, { status: 400 });
    }
    return NextResponse.redirect(new URL(`/register?error=${encodeURIComponent(error)}`, request.url));
  }

  const exists = await findUserByEmail(email);
  if (exists) {
    const error = "A user already exists with this email.";
    if (wantsJson(request)) {
      return NextResponse.json({ error }, { status: 409 });
    }
    return NextResponse.redirect(new URL(`/register?error=${encodeURIComponent(error)}`, request.url));
  }

  const user = await createUser({
    name,
    email,
    passwordHash: hashPassword(password),
    role
  });

  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  const response = wantsJson(request)
    ? NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { status: 201 })
    : NextResponse.redirect(new URL(roleHome[user.role], request.url));

  setAuthCookies(response, sessionUser);

  return response;
}
