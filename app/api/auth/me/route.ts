import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth/session";

/** GET /api/auth/me — who am I? 401 when signed out (the login form uses it). */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Belum log masuk" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
  });
}
