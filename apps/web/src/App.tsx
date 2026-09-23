import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import { LoginPage } from "./features/auth/LoginPage.js";
import { GuestJoinPage } from "./features/guest/GuestJoinPage.js";
import { RegisterChoicePage } from "./features/registration/RegisterChoicePage.js";
import { IndividualRegisterPage } from "./features/registration/IndividualRegisterPage.js";
import { OrganizationRegisterPage } from "./features/registration/OrganizationRegisterPage.js";
import { EmailSentPage } from "./features/registration/EmailSentPage.js";
import { VerifyEmailPage } from "./features/registration/VerifyEmailPage.js";
import { SpacePage } from "./features/spaces/SpacePage.js";
import { AcceptInvitePage } from "./features/spaces/AcceptInvitePage.js";
import { InvitesPage } from "./features/invites/InvitesPage.js";
import { LessonsListPage } from "./features/lessons/LessonsListPage.js";
import { AdminRecordingsPage } from "./features/recordings/AdminRecordingsPage.js";
import { MaterialEditorPage } from "./features/materials/MaterialEditorPage.js";
import { MaterialsEditorLandingPage } from "./features/materials/MaterialsEditorLandingPage.js";
import { MaterialsLibraryPage } from "./features/materials/MaterialsLibraryPage.js";
import { EgressPage } from "./features/recordings/EgressPage.js";
import { RecordingViewerPage } from "./features/recordings/RecordingViewerPage.js";
import { SettingsPage } from "./features/settings/SettingsPage.js";
import { RoomPage } from "./features/room/RoomPage.js";
import { AppShell } from "./shared/AppShell.js";
import { ErrorBoundary } from "./shared/ErrorBoundary.js";
import { RequireAuth } from "./shared/RequireAuth.js";
import { RequireRoomAccess } from "./shared/RequireRoomAccess.js";
import { HomeRedirect, RequireRole } from "./shared/RequireRole.js";
import { Toaster } from "./shared/ui/sonner.js";
import type { Role } from "@school/shared";

/** Защищённая страница внутри общего каркаса приложения. `roles` — если задан, ограничивает доступ. */
function Shell({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const page = (
    <AppShell>
      <ErrorBoundary>{children}</ErrorBoundary>
    </AppShell>
  );
  return <RequireAuth>{roles ? <RequireRole roles={roles}>{page}</RequireRole> : page}</RequireAuth>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Э14.1 — публичная self-signup регистрация (§ план-ТЗ Э14), вне AppShell и RequireAuth. */}
        <Route path="/register" element={<RegisterChoicePage />} />
        <Route path="/register/individual" element={<IndividualRegisterPage />} />
        <Route path="/register/organization" element={<OrganizationRegisterPage />} />
        <Route path="/register/check-email" element={<EmailSentPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        {/* Э14.1/Э14.2 — публичная визитка пространства и приём приглашения, вне AppShell/RequireAuth. */}
        <Route path="/s/:slug" element={<SpacePage />} />
        <Route path="/s/:slug/invite/:code" element={<AcceptInvitePage />} />
        {/* Э14.2 — приглашения в пространство, только admin. */}
        <Route
          path="/admin/invites"
          element={<Shell roles={["admin"]}><InvitesPage /></Shell>}
        />
        {/* Э12.6 — вход ученика по прямой ссылке, вне AppShell и RequireAuth. */}
        <Route path="/j/:token" element={<GuestJoinPage />} />
        {/* §4.2 ТЗ: уроки — admin и teacher; методист сюда не ходит. */}
        <Route
          path="/lessons"
          element={<Shell roles={["admin", "teacher"]}><LessonsListPage /></Shell>}
        />
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
        {/* Э13: библиотека — просмотр/выбор (весь персонал); редактор —
            создание/правка (admin + methodist). Сам лист `/materials/edit/:id`
            открывают все — учитель попадает в него в режиме «Просмотр». */}
        <Route path="/materials" element={<Shell><MaterialsLibraryPage /></Shell>} />
        <Route
          path="/materials/edit"
          element={<Shell roles={["admin", "methodist"]}><MaterialsEditorLandingPage /></Shell>}
        />
        <Route path="/materials/edit/:id" element={<Shell><MaterialEditorPage /></Shell>} />
        {/* §10.10 ТЗ — место на диске + архив записей всей школы, только admin. */}
        <Route
          path="/admin/recordings"
          element={<Shell roles={["admin"]}><AdminRecordingsPage /></Shell>}
        />
        <Route
          path="/admin/recordings/:id"
          element={<Shell roles={["admin"]}><RecordingViewerPage /></Shell>}
        />
        <Route
          path="/admin/settings"
          element={<Shell roles={["admin"]}><SettingsPage /></Shell>}
        />
        {/* Э10.2 — layout-шаблон записи. Открывается headless-Chrome внутри
            LiveKit Egress на второй машине; без нашей сессии, вне каркаса. */}
        <Route path="/egress" element={<EgressPage />} />
        <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
      </Routes>
      <Toaster position="top-right" richColors closeButton />
    </BrowserRouter>
  );
}
