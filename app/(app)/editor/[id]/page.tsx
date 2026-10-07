import type { Metadata } from "next";
import { RphEditor } from "@/components/rph/editor";

export const metadata: Metadata = { title: "Editor RPH · eRPH" };

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RphEditor docId={id} />;
}
