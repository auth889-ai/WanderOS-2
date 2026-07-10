import { notFound, redirect } from "next/navigation";
import { PrintBook } from "@/components/memory/PrintBook";
import { getSession } from "@/lib/auth/session";
import { getBook } from "@/lib/services/memoryBook.service";

export const dynamic = "force-dynamic";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function MemoryBookPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  const book = await getBook(session.id, id);
  if (!book) notFound();
  return <PrintBook book={serialize(book)} />;
}
