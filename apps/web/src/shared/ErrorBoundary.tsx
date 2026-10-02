import { Component, type ErrorInfo, type ReactNode } from "react";

import { errorFields, safePath, track } from "./telemetry.js";
import { Button } from "./ui/button.js";
import { ErrorState } from "./ui/error-state.js";

interface Props {
  children: ReactNode;
  /** Заголовок для показа вместо упавшего поддерева. */
  title?: string;
}

interface State {
  error: Error | null;
}

/**
 * Не догрузился кусок сборки — почти всегда обрыв на слабой связи (файлы
 * прошлых сборок сервер хранит в архиве). Браузер запоминает неудачный
 * `import()`, поэтому помогает только перезагрузка страницы. Тексты ошибок у
 * браузеров разные: Safari/iOS — «Importing a module script failed».
 */
function isChunkLoadError(error: Error): boolean {
  return /dynamically imported module|Importing a module script failed|module script|Loading chunk|Unable to preload CSS/i.test(error.message);
}

/** Ловит ошибки рендера дочернего дерева и показывает восстановимое состояние. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Пойманное границей React 19 не доходит до window.onerror — без этого
    // «доска побелела» в логе сервера было не найти.
    track("client_error", {
      area: "boundary",
      boundary: this.props.title ?? null,
      chunk: isChunkLoadError(error),
      ...errorFields(error),
      component: info.componentStack?.split("\n").find((line) => line.trim())?.trim().slice(0, 120) ?? null,
      path: safePath(),
    });
  }

  private retry = () => this.setState({ error: null });

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-content px-4 py-16">
          {isChunkLoadError(this.state.error) ? (
            <ErrorState
              title="Не удалось загрузить"
              description="Проверьте интернет и перезагрузите страницу."
            />
          ) : (
            // Текст ошибки — в лог (componentDidCatch), не на экран: ученику
            // «Cannot read properties of undefined» ничего не говорит.
            <ErrorState
              title={this.props.title ?? "Что-то пошло не так"}
              description="Попробуйте ещё раз. Если не поможет — перезагрузите страницу."
            />
          )}
          <div className="mt-4 flex justify-center gap-2">
            {isChunkLoadError(this.state.error) ? null : (
              <Button size="sm" onClick={this.retry}>
                Повторить
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              Перезагрузить страницу
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
