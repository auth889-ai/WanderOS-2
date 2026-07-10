import { NextRequest, NextResponse } from "next/server";
import { roleCookieName, userCookieName } from "@/lib/auth/roles";
import { sessionCookieName } from "@/lib/auth/token";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));

  response.cookies.delete(sessionCookieName);
  response.cookies.delete(roleCookieName);
  response.cookies.delete(userCookieName);

  return response;
}
