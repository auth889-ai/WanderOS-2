import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MemoryJarDashboard } from "@/components/jar/MemoryJarDashboard";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MemoryJarsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");
  return (
    <AppShell>
      <MemoryJarDashboard />
    </AppShell>
  );
}
