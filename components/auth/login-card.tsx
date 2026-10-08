"use client";

import { ArrowRight, KeyRound, User } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldError, Input, Label } from "@/components/ui/field";
import { supabaseConfigured } from "@/lib/config";
import { LOCAL_ACCOUNT, LOCAL_DEMO_PASSWORD } from "@/lib/server/auth/local";

/**
 * Username + password sign-in against `erph.user`.
 *
 * Supabase Auth (Google OAuth / GoTrue) is deliberately not used — credentials
 * live in our own table and are verified by scrypt in `/api/auth/login`. The
 * response sets an httpOnly cookie; nothing token-shaped ever reaches JS.
 */
export function LoginCard() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Log masuk gagal. Cuba lagi.");
        return;
      }

      // Full navigation rather than a client-side push: the (app) layout reads
      // the cookie server-side, so the server must render the authenticated
      // shell — a soft navigation would show it stale.
      window.location.assign("/minggu");
    } catch {
      setError("Rangkaian bermasalah. Cuba lagi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-lg">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Log masuk</CardTitle>
        <CardDescription className="pt-1.5">
          Gunakan nama pengguna dan kata laluan sekolah anda.
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-4">
        <form onSubmit={signIn} noValidate>
          <div className="mb-3.5">
            <Label htmlFor="f-login-username" required>
              Nama pengguna
            </Label>
            <Input
              id="f-login-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="cth. nurul.aisyah"
            />
          </div>

          <div className="mb-4">
            <Label htmlFor="f-login-password" required>
              Kata laluan
            </Label>
            <Input
              id="f-login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
            {error && <FieldError id="login-error">{error}</FieldError>}
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Memeriksa…" : "Log masuk"}
            {!busy && <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden />}
          </Button>
        </form>

        {!supabaseConfigured && (
          <p className="mt-3.5 flex gap-2.5 rounded-[10px] border border-info-line bg-info-soft p-3 text-[12.5px] leading-[1.55] text-info-ink">
            <User className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            <span>
              <b>Mod setempat.</b> Tiada pangkalan data ditetapkan. Gunakan demo: nama pengguna{" "}
              <b>{LOCAL_ACCOUNT.username}</b>, kata laluan <b>{LOCAL_DEMO_PASSWORD}</b>. Semua
              ciri berfungsi; penyegerakan aktif sebaik kunci API ditambah.
            </span>
          </p>
        )}
      </CardContent>

      <CardFooter className="flex-col items-start gap-1.5 text-[11.5px] text-ink-4">
        <span className="flex items-center gap-1.5">
          <KeyRound className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
          Kata laluan disimpan dalam bentuk scrypt — ia tidak pernah disimpan secara teks.
        </span>
        <span>
          Dengan menggunakan sistem ini, anda memahami dan bersetuju dengan penyataan data rasmi
          KPM.
        </span>
        <span>Hak Cipta Terpelihara · Kementerian Pendidikan Malaysia</span>
      </CardFooter>
    </Card>
  );
}
