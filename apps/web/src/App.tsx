import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./features/auth/LoginPage.js";
import { LessonsListPage } from "./features/lessons/LessonsListPage.js";
import { HomeworkPage } from "./features/materials/HomeworkPage.js";
import { MaterialEditorPage } from "./features/materials/MaterialEditorPage.js";
import { MaterialsLibraryPage } from "./features/materials/MaterialsLibraryPage.js";
import { EgressPage } from "./features/recordings/EgressPage.js";
import { RoomPage } from "./features/room/RoomPage.js";
import { Layout } from "./shared/Layout.js";
import { RequireAuth } from "./shared/RequireAuth.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/lessons"
          element={
            <RequireAuth>
              <Layout>
                <LessonsListPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/lessons/:id/room"
          element={
            <RequireAuth>
              <RoomPage />
            </RequireAuth>
          }
        />
        <Route
          path="/homework"
          element={
            <RequireAuth>
              <Layout>
                <HomeworkPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/materials"
          element={
            <RequireAuth>
              <Layout>
                <MaterialsLibraryPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/materials/:id/edit"
          element={
            <RequireAuth>
              <Layout>
                <MaterialEditorPage />
              </Layout>
            </RequireAuth>
          }
        />
        {/* Э10.2 — layout-шаблон записи. Открывается headless-Chrome внутри
            LiveKit Egress на второй машине; без нашей сессии, вне Layout. */}
        <Route path="/egress" element={<EgressPage />} />
        <Route path="/" element={<Navigate to="/lessons" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
