import { NextRequest, NextResponse } from "next/server";
import { canAccessPath, getRequiredRoles, isRole, roleCookieName, roleHome } from "./lib/auth/roles";

const staticAssetPattern = /\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|mov|css|js|map|txt|xml|json)$/i;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (shouldSkip(pathname)) {
    return NextResponse.next();
  }

  const roleCookie = request.cookies.get(roleCookieName)?.value;
  const role = isRole(roleCookie) ? roleCookie : null;
  const requiredRoles = getRequiredRoles(pathname);

  if (!requiredRoles || canAccessPath(pathname, role)) {
    return withPrivateCacheHeaders(pathname, NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: role ? "Forbidden for this role." : "Authentication required.",
        requiredRoles
      },
      { status: role ? 403 : 401 }
    );
  }

  const redirectUrl = request.nextUrl.clone();

  if (!role) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  redirectUrl.pathname = roleHome[role];
  redirectUrl.searchParams.set("blocked", pathname);
  return NextResponse.redirect(redirectUrl);
}

function withPrivateCacheHeaders(pathname: string, response: NextResponse) {
  if (
    pathname.startsWith("/trips") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/feed") ||
    pathname.startsWith("/memory") ||
    pathname.startsWith("/host") ||
    pathname.startsWith("/admin")
  ) {
    response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }
  return response;
}

function shouldSkip(pathname: string) {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images") ||
    pathname.startsWith("/videos") ||
    pathname.startsWith("/chrome-extension") ||
    pathname === "/favicon.ico" ||
    staticAssetPattern.test(pathname)
  );
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
