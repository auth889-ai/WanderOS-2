import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getSession } from "@/lib/auth/session";
import { NewMemoryClient } from "./NewMemoryClient";

export const dynamic = "force-dynamic";

export default async function NewMemoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");

  return (
    <AppShell>
      <NewMemoryClient />
    </AppShell>
  );
}
