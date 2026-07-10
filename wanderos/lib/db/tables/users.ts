import { QueryResultRow } from "pg";
import { Role } from "@/lib/auth/roles";
import { queryAurora } from "../pool";

export type UserRow = QueryResultRow & {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  google_id: string | null;
  role: Role;
  status: string;
};

export async function createUser({
  name,
  email,
  passwordHash,
  role
}: {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}) {
  const rows = await queryAurora<UserRow>(
    `insert into users (name, email, password_hash, role)
     values ($1, lower(trim($2)), $3, $4)
     returning id, name, email, password_hash, role, status`,
    [name.trim(), email, passwordHash, role]
  );

  return rows[0];
}

export async function findUserByEmail(email: string) {
  const rows = await queryAurora<UserRow>(
    `select id, name, email, password_hash, role, status
     from users
     where email = lower(trim($1))
     limit 1`,
    [email]
  );

  return rows[0] || null;
}

export async function findUserByGoogleId(googleId: string) {
  const rows = await queryAurora<UserRow>(
    `select id, name, email, password_hash, google_id, role, status
     from users
     where google_id = $1
     limit 1`,
    [googleId]
  );

  return rows[0] || null;
}

export async function findUserById(id: string) {
  const rows = await queryAurora<UserRow>(
    `select id, name, email, password_hash, google_id, role, status
     from users
     where id = $1
     limit 1`,
    [id]
  );

  return rows[0] || null;
}

export async function upsertGoogleUser({
  googleId,
  name,
  email,
  role
}: {
  googleId: string;
  name: string;
  email: string;
  role: Exclude<Role, "admin">;
}) {
  const byGoogle = await findUserByGoogleId(googleId);
  if (byGoogle) {
    return byGoogle;
  }

  const byEmail = await findUserByEmail(email);
  if (byEmail) {
    const rows = await queryAurora<UserRow>(
      `update users
       set google_id = coalesce(google_id, $2), updated_at = now()
       where id = $1
       returning id, name, email, password_hash, google_id, role, status`,
      [byEmail.id, googleId]
    );

    return rows[0];
  }

  const rows = await queryAurora<UserRow>(
    `insert into users (name, email, google_id, role)
     values ($1, lower(trim($2)), $3, $4)
     returning id, name, email, password_hash, google_id, role, status`,
    [name.trim(), email, googleId, role]
  );

  return rows[0];
}
