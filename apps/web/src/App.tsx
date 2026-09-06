import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import { LoginPage } from "./features/auth/LoginPage.js";
import { GuestJoinPage } from "./features/guest/GuestJoinPage.js";
import { LessonsListPage } from "./features/lessons/LessonsListPage.js";
import { MaterialEditorPage } from "./features/materials/MaterialEditorPage.js";
import { MaterialsLibraryPage } from "./features/materials/MaterialsLibraryPage.js";
import { EgressPage } from "./features/recordings/EgressPage.js";
import { RoomPage } from "./features/room/RoomPage.js";
import { AppShell } from "./shared/AppShell.js";
import { ErrorBoundary } from "./shared/ErrorBoundary.js";
import { RequireAuth } from "./shared/RequireAuth.js";
import { RequireRoomAccess } from "./shared/RequireRoomAccess.js";
import { Toaster } from "./shared/ui/sonner.js";

/** Защищённая страница внутри общего каркаса приложения. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </RequireAuth>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Э12.6 — вход ученика по прямой ссылке, вне AppShell и RequireAuth. */}
        <Route path="/j/:token" element={<GuestJoinPage />} />
        <Route path="/lessons" element={<Shell><LessonsListPage /></Shell>} />
        <Route
          path="/lessons/:id/room"
          element={
            <RequireRoomAccess>
              <ErrorBoundary title="Ошибка в уроке">
                <RoomPage />
              </ErrorBoundary>
            </RequireRoomAccess>
          }
        />
        <Route path="/materials" element={<Shell><MaterialsLibraryPage /></Shell>} />
        <Route path="/materials/:id/edit" element={<Shell><MaterialEditorPage /></Shell>} />
        {/* Э10.2 — layout-шаблон записи. Открывается headless-Chrome внутри
            LiveKit Egress на второй машине; без нашей сессии, вне каркаса. */}
        <Route path="/egress" element={<EgressPage />} />
        <Route path="/" element={<Navigate to="/lessons" replace />} />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </BrowserRouter>
  );
}
