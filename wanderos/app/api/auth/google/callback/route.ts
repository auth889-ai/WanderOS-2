import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { verifyOAuthState } from "@/lib/auth/oauth-state";
import { roleHome } from "@/lib/auth/roles";
import { upsertGoogleUser } from "@/lib/db/tables/users";

type GoogleUserInfo = {
  sub?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
};

function getCallbackUrl(request: NextRequest) {
  return process.env.GOOGLE_CALLBACK_URL || new URL("/api/auth/google/callback", request.url).toString();
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state") || "");

  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=Google%20login%20could%20not%20be%20verified.", request.url));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=Google%20OAuth%20is%20not%20configured.", request.url));
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getCallbackUrl(request),
      grant_type: "authorization_code"
    })
  });

  if (!tokenResponse.ok) {
    return NextResponse.redirect(new URL("/login?error=Google%20token%20exchange%20failed.", request.url));
  }

  const tokenJson = await tokenResponse.json();
  const accessToken = String(tokenJson.access_token || "");
  if (!accessToken) {
    return NextResponse.redirect(new URL("/login?error=Google%20did%20not%20return%20an%20access%20token.", request.url));
  }

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!userInfoResponse.ok) {
    return NextResponse.redirect(new URL("/login?error=Google%20profile%20load%20failed.", request.url));
  }

  const profile = (await userInfoResponse.json()) as GoogleUserInfo;
  if (!profile.sub || !profile.email || profile.email_verified === false) {
    return NextResponse.redirect(new URL("/login?error=Google%20email%20is%20not%20verified.", request.url));
  }

  const user = await upsertGoogleUser({
    googleId: profile.sub,
    name: profile.name || profile.email.split("@")[0],
    email: profile.email,
    role: state.role
  });

  const response = NextResponse.redirect(new URL(roleHome[user.role], request.url));
  setAuthCookies(response, {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  });

  return response;
}
