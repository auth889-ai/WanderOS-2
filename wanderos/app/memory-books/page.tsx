import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BuildBookButton } from "@/components/memory/BuildBookButton";
import { BuildFromUploads } from "@/components/memory/BuildFromUploads";
import { getSession } from "@/lib/auth/session";
import { listBooks } from "@/lib/services/memoryBook.service";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { building: "Designing…", ready: "Ready", failed: "Failed" };

export default async function MemoryBooksHub() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const books = await listBooks(session.id).catch(() => []);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-mist"><BookOpen size={13} /> Memory Books</p>
            <h1 className="mt-1 text-3xl font-bold text-white">Your travel keepsakes</h1>
            <p className="mt-1 text-sm text-white/50">AI designs a beautiful scrapbook from your posts — then you edit it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BuildFromUploads />
            <BuildBookButton />
          </div>
        </div>

        {books.length ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((b) => (
              <Link key={b.id} href={`/memory-books/${b.id}`} className="group overflow-hidden rounded-2xl border border-white/10 bg-white/5 transition hover:-translate-y-1 hover:border-coral/40">
                <div className="aspect-[4/3] w-full overflow-hidden bg-white/5">
                  {b.cover_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={b.cover_url} alt="" className="h-full w-full object-cover transition group-hover:scale-105" />
                    : <div className="flex h-full items-center justify-center text-white/30"><BookOpen size={32} /></div>}
                </div>
                <div className="p-4">
                  <p className="truncate font-semibold text-white">{b.title}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-mist">{STATUS_LABEL[b.status] ?? b.status}</p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <BookOpen className="mx-auto text-white/30" size={34} />
            <p className="mt-3 text-white/60">No memory books yet.</p>
            <p className="text-sm text-white/40">Build one from your travel posts in a few seconds.</p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
