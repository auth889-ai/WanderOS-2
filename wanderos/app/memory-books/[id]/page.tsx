import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BookViewer } from "@/components/memory/BookViewer";
import { getSession } from "@/lib/auth/session";
import { getBook } from "@/lib/services/memoryBook.service";

export const dynamic = "force-dynamic";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function MemoryBookPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const { id } = await params;
  const book = await getBook(session.id, id);
  if (!book) notFound();

  return (
    <AppShell>
      <BookViewer initial={serialize(book)} />
    </AppShell>
  );
}
