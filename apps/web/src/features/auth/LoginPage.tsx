import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { LoginRequest, MeResponse } from "@school/shared";
import { apiFetch, ApiError } from "../../shared/api-client.js";
import { useAuthStore } from "../../shared/auth-store.js";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: LoginRequest = { email, password };
      const data = await apiFetch<{ accessToken: string; user: MeResponse }>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setAuth(data.accessToken, data.user);
      navigate("/lessons");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="mb-4 text-xl font-semibold">Вход</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded border px-3 py-2"
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded border px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-slate-900 px-3 py-2 text-white disabled:opacity-50"
        >
          {submitting ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
