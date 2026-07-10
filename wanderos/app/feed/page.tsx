import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { FeedView } from "@/components/feed/FeedView";
import type { FeedPost } from "@/components/feed/PostCard";
import { getSession } from "@/lib/auth/session";
import { getFeed } from "@/lib/services/feed.service";

export const dynamic = "force-dynamic";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function FeedPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const feedPosts = await getFeed({ viewerId: session.id, tab: "for-you", limit: 24 }).catch(() => []);

  return (
    <AppShell>
      <FeedView initialPosts={serialize(feedPosts) as FeedPost[]} viewerId={session.id} />
    </AppShell>
  );
}
