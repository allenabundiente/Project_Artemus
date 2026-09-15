// Admin audit log + admin account management.
//
// The audit trail answers "who uploaded which sprite, edited which theme,
// created which shop item" — every mutating admin-panel action inserts one
// row here. Logging is best-effort at the route layer (a failed insert never
// breaks the action itself), but it rides the same transaction where one is
// already open so the record and the change commit together.
import { query, queryOne } from './db.js';

export type AuditAction =
  | 'sprite_upload'
  | 'sprite_restore'
  | 'animation_save'
  | 'animation_delete'
  | 'theme_save'
  | 'theme_delete'
  | 'map_config_save'
  | 'shop_item_create'
  | 'shop_item_delete'
  | 'feature_lock'
  | 'admin_created'
  | 'admin_granted'
  | 'admin_revoked';

export type AuditEntryRow = {
  id: number;
  actorId: string | null;
  actorName: string;
  action: string;
  target: string;
  detail: Record<string, unknown>;
  createdAt: string;
};

export async function insertAuditEntry(entry: {
  actorId?: string | null;
  actorName: string;
  action: AuditAction;
  target?: string;
  /** Jsonb detail — accept any object shape (e.g. typed MapConfig). */
  detail?: object;
}): Promise<void> {
  await query(
    `INSERT INTO admin_audit_log (actor_id, actor_name, action, target, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [entry.actorId ?? null, entry.actorName, entry.action, entry.target ?? '', JSON.stringify(entry.detail ?? {})],
  );
}

/** Newest-first audit feed for the AdminPanel (bounded page). */
export async function listAuditEntries(limit = 100): Promise<AuditEntryRow[]> {
  const rows = await query<AuditEntryRow>(
    `SELECT id, actor_id AS "actorId", actor_name AS "actorName", action, target, detail, created_at::text AS "createdAt"
     FROM admin_audit_log
     ORDER BY id DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 500)],
  );
  return rows;
}

// --- admin account management -------------------------------------------------

export type AdminListRow = { id: string; name: string; email: string; createdAt: string };

export async function listAdmins(): Promise<AdminListRow[]> {
  return query<AdminListRow>(
    `SELECT id, name, email, created_at::text AS "createdAt" FROM users WHERE role = 'admin' ORDER BY created_at`,
  );
}

/** Promote an existing user to admin by email. Returns null when not found. */
export async function grantAdminByEmail(email: string): Promise<AdminListRow | null> {
  const row = await queryOne<AdminListRow>(
    `UPDATE users SET role = 'admin' WHERE lower(email) = lower($1)
     RETURNING id, name, email, created_at::text AS "createdAt"`,
    [email.trim()],
  );
  return row ?? null;
}

/** Create a brand-new admin account. Returns 'exists' when the email is taken. */
export async function createAdmin(
  name: string,
  email: string,
  passwordHash: string,
): Promise<AdminListRow | 'exists'> {
  const dupe = await queryOne(`SELECT 1 AS x FROM users WHERE lower(email) = lower($1)`, [email]);
  if (dupe) return 'exists';
  const row = await queryOne<AdminListRow>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     RETURNING id, name, email, created_at::text AS "createdAt"`,
    [name, email, passwordHash],
  );
  return row as AdminListRow;
}

/**
 * Demote an admin to a plain student — the panel's guard rail against locking
 * yourself out of every key. Returns null when the user is not an admin.
 */
export async function demoteAdmin(id: string): Promise<AdminListRow | null> {
  const count = await queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users WHERE role = 'admin'`);
  if (Number(count?.c ?? 0) <= 1) return null;
  const row = await queryOne<AdminListRow>(
    `UPDATE users SET role = 'student' WHERE id = $1 AND role = 'admin'
     RETURNING id, name, email, created_at::text AS "createdAt"`,
    [id],
  );
  return row ?? null;
}
