import { NextRequest, NextResponse } from "next/server";
import { createOAuthState } from "@/lib/auth/oauth-state";

function getCallbackUrl(request: NextRequest) {
  return process.env.GOOGLE_CALLBACK_URL || new URL("/api/auth/google/callback", request.url).toString();
}

export function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=Google%20client%20ID%20is%20not%20configured.", request.url));
  }

  const roleParam = request.nextUrl.searchParams.get("role");
  const role = roleParam === "host" ? "host" : "traveler";
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", getCallbackUrl(request));
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", createOAuthState(role));
  authUrl.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(authUrl);
}
