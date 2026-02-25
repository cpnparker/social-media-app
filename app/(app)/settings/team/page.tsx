"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TeamSettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/settings/workspace");
  }, [router]);

  return null;
}
