import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MemoryEditor } from "@/components/memory/editor/MemoryEditor";
import { getSession } from "@/lib/auth/session";
import { getBook } from "@/lib/services/memoryBook.service";

export const dynamic = "force-dynamic";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function MemoryBookEditPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const { id } = await params;
  const book = await getBook(session.id, id);
  if (!book) notFound();

  return (
    <AppShell>
      <MemoryEditor book={serialize(book)} />
    </AppShell>
  );
}
