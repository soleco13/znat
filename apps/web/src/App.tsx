import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Suspense, type ReactNode } from "react";

import { GuestJoinPage } from "./features/guest/GuestJoinPage.js";
import { AppShell } from "./shared/AppShell.js";
import { ErrorBoundary } from "./shared/ErrorBoundary.js";
import { RequireAuth } from "./shared/RequireAuth.js";
import { RequireRoomAccess } from "./shared/RequireRoomAccess.js";
import { HomeRedirect, RequireRole } from "./shared/RequireRole.js";
import { Toaster } from "./shared/ui/sonner.js";
import type { Role } from "@school/shared";
import { FullscreenLoader } from "./shared/ui/fullscreen-loader.js";
import { lazyNamed } from "./shared/lazy-retry.js";

// Каждая страница — отдельный кусок сборки: раньше всё приложение было одним
// файлом 4,9 МБ, и на мобильной сети страница урока не открывалась. Вход
// ученика по ссылке (`GuestJoinPage`) — в основном куске, он открывается первым.
const LoginPage = lazyNamed(() => import("./features/auth/LoginPage.js"), "LoginPage");
const ChangePasswordPage = lazyNamed(() => import("./features/account/ChangePasswordPage.js"), "ChangePasswordPage");
const ForgotPasswordPage = lazyNamed(() => import("./features/account/ForgotPasswordPage.js"), "ForgotPasswordPage");
const ResetPasswordPage = lazyNamed(() => import("./features/account/ResetPasswordPage.js"), "ResetPasswordPage");
const PrivacyPolicyPage = lazyNamed(() => import("./features/legal/PrivacyPolicyPage.js"), "PrivacyPolicyPage");
const RegisterChoicePage = lazyNamed(() => import("./features/registration/RegisterChoicePage.js"), "RegisterChoicePage");
const IndividualRegisterPage = lazyNamed(() => import("./features/registration/IndividualRegisterPage.js"), "IndividualRegisterPage");
const OrganizationRegisterPage = lazyNamed(() => import("./features/registration/OrganizationRegisterPage.js"), "OrganizationRegisterPage");
const EmailSentPage = lazyNamed(() => import("./features/registration/EmailSentPage.js"), "EmailSentPage");
const VerifyEmailPage = lazyNamed(() => import("./features/registration/VerifyEmailPage.js"), "VerifyEmailPage");
const SpacePage = lazyNamed(() => import("./features/spaces/SpacePage.js"), "SpacePage");
const AcceptInvitePage = lazyNamed(() => import("./features/spaces/AcceptInvitePage.js"), "AcceptInvitePage");
const InvitesPage = lazyNamed(() => import("./features/invites/InvitesPage.js"), "InvitesPage");
const LessonsListPage = lazyNamed(() => import("./features/lessons/LessonsListPage.js"), "LessonsListPage");
const AdminRecordingsPage = lazyNamed(() => import("./features/recordings/AdminRecordingsPage.js"), "AdminRecordingsPage");
const MaterialEditorPage = lazyNamed(() => import("./features/materials/MaterialEditorPage.js"), "MaterialEditorPage");
const MaterialsEditorLandingPage = lazyNamed(() => import("./features/materials/MaterialsEditorLandingPage.js"), "MaterialsEditorLandingPage");
const MaterialsLibraryPage = lazyNamed(() => import("./features/materials/MaterialsLibraryPage.js"), "MaterialsLibraryPage");
const EgressPage = lazyNamed(() => import("./features/recordings/EgressPage.js"), "EgressPage");
const RecordingViewerPage = lazyNamed(() => import("./features/recordings/RecordingViewerPage.js"), "RecordingViewerPage");
const SettingsPage = lazyNamed(() => import("./features/settings/SettingsPage.js"), "SettingsPage");
const RoomPage = lazyNamed(() => import("./features/room/RoomPage.js"), "RoomPage");

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
      <Suspense fallback={<FullscreenLoader label="Загрузка…" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Э14.1 — публичная self-signup регистрация (§ план-ТЗ Э14), вне AppShell и RequireAuth. */}
        <Route path="/register" element={<RegisterChoicePage />} />
        <Route path="/register/individual" element={<IndividualRegisterPage />} />
        <Route path="/register/organization" element={<OrganizationRegisterPage />} />
        <Route path="/register/check-email" element={<EmailSentPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/account/password" element={<Shell><ChangePasswordPage /></Shell>} />
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
      </Suspense>
      <Toaster position="top-right" richColors closeButton />
    </BrowserRouter>
  );
}
