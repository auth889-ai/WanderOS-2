export const roles = ["traveler", "host", "admin"] as const;

export type Role = (typeof roles)[number];

export const roleCookieName = "wanderos_role";
export const userCookieName = "wanderos_user";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export const roleHome: Record<Role, string> = {
  traveler: "/dashboard",
  host: "/host/dashboard",
  admin: "/admin"
};

const publicPagePaths = ["/", "/login", "/register", "/onboarding"];
const publicApiPrefixes = ["/api/auth"];

const routeAccess: Array<{ prefixes: string[]; roles: Role[] }> = [
  {
    prefixes: ["/admin"],
    roles: ["admin"]
  },
  {
    prefixes: ["/hosts/new"],
    roles: ["host", "admin"]
  },
  {
    prefixes: ["/dashboard", "/trips", "/feed", "/research", "/memory-jars", "/memory-books", "/agent-runs"],
    roles: ["traveler", "admin"]
  },
  {
    // All authenticated roles may reach /api/agents; each route enforces its own role
    // (e.g. host-studio is host-only, extension is traveler-only) via requireApiRole.
    prefixes: ["/api/agents"],
    roles: ["traveler", "host", "admin"]
  },
  {
    prefixes: ["/api/extension", "/api/agent-runs"],
    roles: ["traveler", "admin"]
  }
];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.includes(value as Role);
}

export function getRequiredRoles(pathname: string): Role[] | null {
  const normalized = normalizePath(pathname);

  if (publicPagePaths.includes(normalized) || publicApiPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return null;
  }

  const access = routeAccess.find((item) => item.prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)));
  return access?.roles ?? null;
}

export function canAccessPath(pathname: string, role?: Role | null) {
  const requiredRoles = getRequiredRoles(pathname);
  if (!requiredRoles) {
    return true;
  }

  return Boolean(role && requiredRoles.includes(role));
}

function normalizePath(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}
