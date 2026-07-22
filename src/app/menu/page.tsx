"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { PosMenuAdmin } from "@/components/PosMenuAdmin";
import { useAuth } from "@/lib/auth";

export default function MenuCatalogPage() {
  return (
    <AuthGate>
      <MenuCatalogGate />
    </AuthGate>
  );
}

function MenuCatalogGate() {
  const { staff } = useAuth();
  const router = useRouter();
  const isOwner = staff?.role === "owner";

  useEffect(() => {
    if (staff && !isOwner) router.replace("/more/");
  }, [staff, isOwner, router]);

  if (!isOwner) return null;

  return (
    <div className="menu-boh-page">
      <p className="muted menu-boh-lead">
        แหล่งหลักของเมนูร้าน — ค้นหา · สำเนา · เก็บเข้าคลัง · ราคาหน้าร้าน/เดลิเวอรี่ แล้วไปขึ้นหน้าขายเอง
      </p>
      <PosMenuAdmin embedded authMode="owner" />
    </div>
  );
}
