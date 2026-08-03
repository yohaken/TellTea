"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { StickyNote } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { BusinessNotesView } from "@/components/BusinessNotesView";
import { useAuth } from "@/lib/auth";

export default function BusinessNotesPage() {
  return (
    <AuthGate>
      <BusinessNotesPageView />
    </AuthGate>
  );
}

function BusinessNotesPageView() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";
  const actor = staff?.id || staff?.email || "owner";

  useEffect(() => {
    if (staff && !isOwner) {
      router.replace("/more/");
    }
  }, [staff, isOwner, router]);

  if (!isOwner) return null;

  return (
    <div className="business-notes-page">
      <header className="business-notes-head">
        <h1 className="panel-title business-notes-title">
          <StickyNote size={18} aria-hidden />
          โนตกิจการ
        </h1>
      </header>
      <BusinessNotesView actor={actor} />
    </div>
  );
}
