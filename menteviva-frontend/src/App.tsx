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
import { DiagnosticoRecomendacion } from "./pages/DiagnosticoRecomendacion";
import { Landing } from "./pages/Landing";
import { MiPlan } from "./pages/MiPlan";
import { useSessionStore } from "./stores/sessionStore";
import { useFirebaseAuth } from "./hooks/useFirebaseAuth";

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

/**
 * Root "/": landing publica para visitantes nuevos; dashboard para usuarios
 * con perfil completo; flujo de setup si tienen registro pero no diagnostico.
 */
function Root() {
  const userProfile = useSessionStore((s) => s.userProfile);
  if (!userProfile?.registro) return <Landing />;
  if (!userProfile.diagnostico) return <Navigate to="/diagnostico/setup" replace />;
  return <Dashboard />;
}

function App() {
  // Listener global de Firebase auth: hidrata sessionStore en login,
  // limpia en logout. Si Firebase no esta configurado, no hace nada y
  // se respeta el flujo legacy de localStorage.
  useFirebaseAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/diagnostico/setup" element={<DiagnosticoSetup />} />
        <Route path="/diagnostico" element={<Diagnostico />} />
        <Route path="/diagnostico/perfil" element={<DiagnosticoPerfil />} />
        <Route path="/diagnostico/recomendacion" element={<DiagnosticoRecomendacion />} />

        <Route path="/" element={<Root />} />
        <Route path="/dashboard" element={<OnboardingGuard><Dashboard /></OnboardingGuard>} />
        <Route path="/briefing" element={<OnboardingGuard><Briefing /></OnboardingGuard>} />
        <Route path="/simulation" element={<OnboardingGuard><Simulation /></OnboardingGuard>} />
        <Route path="/report" element={<OnboardingGuard><Report /></OnboardingGuard>} />
        <Route path="/mi-plan" element={<OnboardingGuard><MiPlan /></OnboardingGuard>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
