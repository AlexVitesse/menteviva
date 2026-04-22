import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Briefing } from "./pages/Briefing";
import { Simulation } from "./pages/Simulation";
import { Report } from "./pages/Report";
import { Login } from "./pages/Login";
import { Registro } from "./pages/Registro";
import { DiagnosticoSetup } from "./pages/DiagnosticoSetup";
import { Diagnostico } from "./pages/Diagnostico";
import { DiagnosticoPerfil } from "./pages/DiagnosticoPerfil";
import { useSessionStore } from "./stores/sessionStore";

/**
 * Guard de onboarding:
 * - Sin perfil en localStorage -> /login (elige crear cuenta o iniciar sesion)
 * - Con registro pero sin diagnostico -> /diagnostico/setup
 * - Con ambos -> renderiza la ruta original
 *
 * Se aplica a rutas "protegidas" (dashboard y flujo de practica).
 * /login, /registro y rutas del diagnostico se auto-resuelven (no aplican guard).
 */
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const userProfile = useSessionStore((s) => s.userProfile);
  const location = useLocation();

  if (!userProfile?.registro) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!userProfile.diagnostico) {
    return <Navigate to="/diagnostico/setup" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/diagnostico/setup" element={<DiagnosticoSetup />} />
        <Route path="/diagnostico" element={<Diagnostico />} />
        <Route path="/diagnostico/perfil" element={<DiagnosticoPerfil />} />

        <Route path="/" element={<OnboardingGuard><Dashboard /></OnboardingGuard>} />
        <Route path="/briefing" element={<OnboardingGuard><Briefing /></OnboardingGuard>} />
        <Route path="/simulation" element={<OnboardingGuard><Simulation /></OnboardingGuard>} />
        <Route path="/report" element={<OnboardingGuard><Report /></OnboardingGuard>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
