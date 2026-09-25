import { useState } from "react";

import { ApiError } from "@/shared/api-client";
import { Button } from "@/shared/ui/button";
import { resendVerification } from "./registration-api.js";

/** «Письмо не пришло» — повторная отправка ссылки подтверждения на тот же адрес. */
export function ResendVerificationButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setState("sending");
    setMessage(null);
    try {
      await resendVerification(email);
      setState("sent");
    } catch (err) {
      setState("error");
      setMessage(err instanceof ApiError ? err.message : "Не удалось отправить письмо");
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button type="button" variant="outline" onClick={onClick} loading={state === "sending"} disabled={state === "sent"}>
        {state === "sent" ? "Письмо отправлено" : "Отправить письмо ещё раз"}
      </Button>
      {state === "sent" ? (
        <p className="text-xs text-muted-foreground">Если письма нет — проверьте «Спам». Повторить можно через минуту.</p>
      ) : null}
      {message ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
