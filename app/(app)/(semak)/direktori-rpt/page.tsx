"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseConfigured } from "@/lib/config";

export default function DirektoriRptPage() {
  const query = useQuery({
    queryKey: ["directory-rpt"],
    enabled: supabaseConfigured,
    queryFn: async () => {
      const response = await fetch("/api/review/rpt");
      if (!response.ok) throw new Error("Gagal memuatkan direktori RPT.");
      return (await response.json()) as {
        items: {
          id: string;
          owner_id: string;
          session: string;
          title: string;
          url: string;
          owner: { full_name: string } | null;
        }[];
      };
    },
  });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Direktori RPT guru</h1>
        <p className="text-sm text-ink-3">
          Pautan bagi guru di bawah penyeliaan anda, mengikut sesi dan guru.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-2 py-4">
          {!supabaseConfigured && <p>Direktori RPT memerlukan pangkalan data.</p>}
          {query.isLoading && supabaseConfigured && <p>Memuatkan direktori…</p>}
          {query.isError && (
            <p role="alert">Gagal memuatkan direktori RPT. Cuba muat semula.</p>
          )}
          {query.data?.items.length === 0 && <p>Tiada guru di bawah penyeliaan anda.</p>}
          {[...new Set((query.data?.items ?? []).map((item) => item.session))]
            .sort()
            .reverse()
            .map((session) => {
              const links = (query.data?.items ?? []).filter(
                (item) => item.session === session,
              );
              const teachers = [
                ...new Map(
                  links.map((item) => [item.owner_id, item.owner?.full_name ?? "Guru"]),
                ).entries(),
              ].sort((a, b) => a[1].localeCompare(b[1]));
              return (
                <details key={session} className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer font-bold">Sesi {session}</summary>
                  {teachers.map(([id, name]) => (
                    <details key={id} className="ml-3 mt-2 border-l border-border pl-3">
                      <summary className="cursor-pointer font-semibold">{name}</summary>
                      <ul className="space-y-2 py-2 text-sm">
                        {links
                          .filter((link) => link.owner_id === id)
                          .map((link) => (
                            <li key={link.id}>
                              <a
                                className="text-primary-ink underline"
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {link.title} ↗
                              </a>
                            </li>
                          ))}
                      </ul>
                    </details>
                  ))}
                </details>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
