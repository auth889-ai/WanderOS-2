import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DiscoverHub } from "@/components/discover/DiscoverHub";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DiscoverPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");
  return (
    <AppShell>
      <DiscoverHub />
    </AppShell>
  );
}
