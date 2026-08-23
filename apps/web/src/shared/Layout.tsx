import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "./api-client.js";
import { useAuthStore } from "./auth-store.js";

export function Layout({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const navigate = useNavigate();

  async function logout() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    clearAuth();
    navigate("/login");
  }

  return (
    <div>
      <header className="flex items-center justify-between border-b px-4 py-2">
        <span className="font-semibold">Школа онлайн</span>
        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span>
              {user.fullName} ({user.role})
            </span>
            <button onClick={logout} className="text-slate-500 underline">
              Выйти
            </button>
          </div>
        )}
      </header>
      <main>{children}</main>
    </div>
  );
}
