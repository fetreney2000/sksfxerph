import { handleExpiredSession } from "@/lib/client/auth-session";
import type { Curriculum, MemberRole } from "@/lib/types";

/**
 * Typed calls into `/api/admin/*` and the two reference-data endpoints.
 *
 * Kept in one place because every one of them does the same three things and
 * gets them wrong in the same way when they are inlined: it must send the
 * session cookie, it must turn a non-2xx into a *Malay* message a school
 * administrator can act on (the server already returns one — the job here is
 * not to swallow it), and it must send the user to /login when the cookie has
 * expired rather than rendering an empty table that looks like "no accounts".
 *
 * Every endpoint under `/api/admin` is gated twice — `requireAdministrator` in
 * the route, `has_role(..., 'pentadbir')` inside the function — so a failure
 * here is rarely authorization. It is almost always the message worth showing.
 */

/** Every route answers with `{ error }` on failure; this is that, or a fallback. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (handleExpiredSession(res.status)) throw new Error("Sesi tamat");

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "";
    throw new Error(message || `Gagal (${res.status})`);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const patch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });

/* ── Accounts ─────────────────────────────────────────────────────────────── */

export interface Member {
  user_id: string;
  username: string;
  full_name: string;
  email: string | null;
  role: MemberRole;
  is_active: boolean;
  last_login_at: string | null;
  locked_until: string | null;
  failed_logins: number;
  password_changed_at: string | null;
}

export interface NewAccount {
  username: string;
  fullName: string;
  role: MemberRole;
  email: string | null;
  password: string;
}

export const listMembers = () => request<{ items: Member[] }>("/api/admin/accounts");

export const createAccount = (body: NewAccount) =>
  request<{ ok: boolean; userId: string }>("/api/admin/accounts", json(body));

/** Role + active flag together — `admin_set_member` writes both or neither. */
export const setMember = (userId: string, role: MemberRole, isActive: boolean) =>
  request<{ ok: boolean }>("/api/admin/accounts", patch({ userId, role, isActive }));

export const resetPassword = (userId: string, password: string) =>
  request<{ ok: boolean }>("/api/admin/accounts", patch({ userId, password }));

export const unlockMember = (userId: string) =>
  request<{ ok: boolean }>("/api/admin/accounts", patch({ userId, unlock: true }));

/* ── Classes ──────────────────────────────────────────────────────────────── */

export interface ClassRow {
  id: string;
  nama: string;
  tahun: number | null;
  tingkatan: number | null;
  is_active: boolean;
  doc_count: number;
}

export const listAdminClasses = () =>
  request<{ items: ClassRow[]; session: string }>("/api/admin/classes");

export const createClass = (body: { nama: string; tahun: number | null; session: string }) =>
  request<{ ok: boolean; id: string }>("/api/classes", json(body));

export const setClass = (body: {
  id: string;
  nama: string;
  tahun: number | null;
  session: string;
  isActive: boolean;
}) => request<{ ok: boolean }>("/api/classes", patch(body));

/* ── Subjects ─────────────────────────────────────────────────────────────── */

export interface SubjectRow {
  code: string;
  nama: string;
  curriculum: Curriculum;
  is_active: boolean;
  doc_count: number;
}

export const listAdminSubjects = () => request<{ items: SubjectRow[] }>("/api/admin/subjects");

export const createSubject = (body: { code: string; nama: string; curriculum: Curriculum }) =>
  request<{ ok: boolean }>("/api/admin/subjects", json(body));

export const setSubject = (code: string, isActive: boolean) =>
  request<{ ok: boolean }>("/api/admin/subjects", patch({ code, isActive }));

/* ── Settings ─────────────────────────────────────────────────────────────── */

/**
 * The school's identity — what `/pentadbiran` edits and what the login screen,
 * sidebar, breadcrumb and printed RPH then show everywhere.
 *
 * `PATCH` takes a `FormData`, not JSON, because the crest rides along as a file.
 * Setting `content-type` here would clobber the multipart boundary the browser
 * generates, so this one bypasses `request()` rather than reusing it.
 */
export const getSchool = () => request<{ school: SchoolIdentity | null }>("/api/admin/school");

export async function setSchool(form: FormData): Promise<{ school: SchoolIdentity | null }> {
  const res = await fetch("/api/admin/school", {
    method: "PATCH",
    credentials: "same-origin",
    body: form,
  });
  if (handleExpiredSession(res.status)) throw new Error("Sesi tamat");
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "";
    throw new Error(message || `Gagal (${res.status})`);
  }
  return body as { school: SchoolIdentity | null };
}

export interface SchoolIdentity {
  id: string;
  kod_sekolah: string;
  nama: string;
  level: string;
  ppd: string | null;
  jpn: string | null;
  motto: string | null;
  logo_url: string | null;
}

export interface SchoolSetting {
  current_session: string;
  submit_weekday: number;
  submit_time: string;
  require_complete: boolean;
}

export interface SchoolInfo {
  id: string;
  kod_sekolah: string;
  nama: string;
  level: string;
  ppd: string | null;
  jpn: string | null;
}

export const getSettings = () =>
  request<{ setting: SchoolSetting | null; school: SchoolInfo | null }>("/api/admin/settings");
export const setSettings = (body: {
  submitWeekday: number;
  submitTime: string;
  requireComplete: boolean;
  currentSession?: string;
}) => request<{ ok: boolean }>("/api/admin/settings", patch(body));
