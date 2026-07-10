import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PostDetail } from "@/components/feed/PostDetail";
import type { FeedPost, PostMedia } from "@/components/feed/types";
import { getSession } from "@/lib/auth/session";
import { getVisiblePost } from "@/lib/services/post.service";

export const dynamic = "force-dynamic";

function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "host") redirect("/host/dashboard");
  if (session.role === "admin") redirect("/admin");

  const { id } = await params;
  const result = await getVisiblePost(session.id, id);
  if (!result) notFound();

  return (
    <AppShell>
      <PostDetail post={serialize(result.post) as unknown as FeedPost} media={serialize(result.media) as unknown as PostMedia[]} viewerId={session.id} />
    </AppShell>
  );
}
