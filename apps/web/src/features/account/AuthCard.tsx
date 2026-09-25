import type { ReactNode } from "react";

import { AuthHeading, AuthLayout, LobbyAside } from "../auth/AuthLayout.js";

/** Страница авторизации в общем макете входа и регистрации (форма слева, тетрадный лист справа). */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <AuthLayout aside={<LobbyAside />}>
      <AuthHeading title={title} subtitle={subtitle} />
      {children}
    </AuthLayout>
  );
}
