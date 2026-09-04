import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./features/auth/LoginPage.js";
import { LessonsListPage } from "./features/lessons/LessonsListPage.js";
import { HomeworkPage } from "./features/materials/HomeworkPage.js";
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
        <Route path="/" element={<Navigate to="/lessons" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
