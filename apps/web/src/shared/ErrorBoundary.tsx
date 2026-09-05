import { Component, type ErrorInfo, type ReactNode } from "react";

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

/** Ловит ошибки рендера дочернего дерева и показывает восстановимое состояние. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-content px-4 py-16">
          <ErrorState
            title={this.props.title ?? "Что-то пошло не так"}
            description={this.state.error.message}
          />
          <div className="mt-4 flex justify-center">
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
