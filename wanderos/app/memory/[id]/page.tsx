import { MemoryJobConsole } from "./MemoryJobConsole";

export default async function MemoryJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MemoryJobConsole jobId={id} />;
}
