import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findUserById } from "@/lib/db/tables/users";
import { Role, SessionUser } from "./roles";
import { sessionCookieName, verifySessionToken } from "./token";

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  const payload = verifySessionToken(token);

  if (!payload) {
    return null;
  }

  try {
    const user = await findUserById(payload.id);
    if (!user || user.status !== "active") {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    };
  } catch {
    return null;
  }
}

export async function requireApiRole(allowedRoles: Role[]) {
  const session = await getSession();

  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 })
    };
  }

  if (!allowedRoles.includes(session.role)) {
    return {
      session,
      response: NextResponse.json({ error: "This role cannot access this resource." }, { status: 403 })
    };
  }

  return { session, response: null };
}
