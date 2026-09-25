"use client";

import { useTransition } from "react";
import { Languages } from "lucide-react";
import { setLocaleAction } from "@/i18n/actions";
import type { Locale } from "@/i18n/config";
import { Button } from "@/components/ui/button";

export function LocaleSwitcher({ locale, label }: { locale: Locale; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => setLocaleAction(locale === "ar" ? "en" : "ar"))}
    >
      <Languages />
      {label}
    </Button>
  );
}
