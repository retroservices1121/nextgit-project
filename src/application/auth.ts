export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

export async function currentUser(request: Request, db: D1Database): Promise<SessionUser | null> {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|; )nextgit_session=([^;]+)/)?.[1];
  if (!token) return null;
  const row = await db.prepare(
    "SELECT u.id,u.email,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')"
  ).bind(token).first<SessionUser>();
  return row || null;
}

export async function requireProjectAccess(db: D1Database, userId: string, projectId: string) {
  return await db.prepare(
    "SELECT p.id,p.name,p.repository_name,p.visibility,CASE WHEN p.owner_user_id=? THEN 'owner' ELSE pm.role END AS role FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=? WHERE p.id=? AND (p.owner_user_id=? OR pm.user_id=?)"
  ).bind(userId,userId,projectId,userId,userId).first<any>();
}

export function sessionCookie(token: string): string {
  return `nextgit_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}
