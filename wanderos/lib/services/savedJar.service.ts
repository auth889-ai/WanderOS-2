import { queryAurora } from "@/lib/db/pool";

export type SavedJar = { id: string; owner_id: string; name: string; mode: string; jar_src: string | null; scene_url: string | null; movie_url: string | null; movie_id: string | null; created_at: string };

export async function saveJar(uid: string, j: { name: string; mode: string; jarSrc?: string | null; sceneUrl?: string | null; movieUrl?: string | null; movieId?: string | null }): Promise<SavedJar> {
  const [row] = await queryAurora<SavedJar>(
    `insert into saved_jars (owner_id, name, mode, jar_src, scene_url, movie_url, movie_id) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [uid, j.name.slice(0, 60) || "My Jar", j.mode === "code" ? "code" : "image", j.jarSrc ?? null, j.sceneUrl ?? null, j.movieUrl ?? null, j.movieId ?? null]
  );
  return row;
}
export async function listJars(uid: string): Promise<SavedJar[]> {
  return queryAurora<SavedJar>(`select * from saved_jars where owner_id=$1 order by created_at desc limit 50`, [uid]);
}
export async function renameJar(uid: string, id: string, name: string): Promise<boolean> {
  const r = await queryAurora(`update saved_jars set name=$3 where id=$1 and owner_id=$2`, [id, uid, name.slice(0, 60)]);
  return (r as unknown as { rowCount?: number }).rowCount !== 0;
}
export async function copyJar(uid: string, id: string): Promise<SavedJar | null> {
  const [src] = await queryAurora<SavedJar>(`select * from saved_jars where id=$1 and owner_id=$2`, [id, uid]);
  if (!src) return null;
  return saveJar(uid, { name: `${src.name} (copy)`, mode: src.mode, jarSrc: src.jar_src, sceneUrl: src.scene_url, movieUrl: src.movie_url, movieId: src.movie_id });
}
export async function deleteJar(uid: string, id: string): Promise<void> {
  await queryAurora(`delete from saved_jars where id=$1 and owner_id=$2`, [id, uid]);
}
