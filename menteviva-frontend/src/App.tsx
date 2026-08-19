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
import { Privacidad, Terminos } from "./pages/Legal";
import { MiPlan } from "./pages/MiPlan";
import { AvatarSnapshot } from "./pages/__AvatarSnapshot";
import { ChatLab } from "./pages/ChatLab";
import { VoiceLab } from "./pages/VoiceLab";
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
function OnboardingGuard({
  children,
  authStatus,
}: {
  children: React.ReactNode;
  authStatus: ReturnType<typeof useFirebaseAuth>["status"];
}) {
  const userProfile = useSessionStore((s) => s.userProfile);
  const needsRegistration = useSessionStore((s) => s.needsRegistration);
  const location = useLocation();

  if (authStatus === "anonymous" || authStatus === "error") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Autenticado en Firebase pero sin fila en la DB: completar registro primero.
  if (needsRegistration) {
    return <Navigate to="/registro" replace state={{ from: location.pathname }} />;
  }
  if (!userProfile?.registro) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!userProfile.diagnostico) {
    return <Navigate to="/diagnostico/setup" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function AuthGuard({
  children,
  authStatus,
}: {
  children: React.ReactNode;
  authStatus: ReturnType<typeof useFirebaseAuth>["status"];
}) {
  const location = useLocation();
  if (authStatus === "anonymous" || authStatus === "error") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Pantalla cuando /auth/sync falla por algo que NO es 404 (401/500/503): en vez
 * de dejar al usuario en el landing sin explicacion, mostramos el error con un
 * boton de reintento (recarga -> re-dispara onAuthStateChanged -> reintenta sync;
 * cubre el caso de Neon despertando del suspend).
 */
function AuthErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-ink text-cream flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-card rounded-2xl border border-white/10 p-8 text-center">
        <h1 className="font-syne text-2xl font-bold mb-3">No pudimos cargar tu sesión</h1>
        <p className="text-muted text-sm mb-6">{message}</p>
        <button
          onClick={() => window.location.reload()}
          className="w-full font-syne font-bold text-sm py-3 rounded-[10px] bg-violet text-white hover:bg-violet-light transition-colors"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}

/**
 * Root "/": landing publica para visitantes nuevos; dashboard para usuarios
 * con perfil completo; flujo de setup si tienen registro pero no diagnostico.
 */
function Root() {
  const userProfile = useSessionStore((s) => s.userProfile);
  const needsRegistration = useSessionStore((s) => s.needsRegistration);
  const authError = useSessionStore((s) => s.authError);
  if (authError) return <AuthErrorScreen message={authError} />;
  if (needsRegistration) return <Navigate to="/registro" replace />;
  if (!userProfile?.registro) return <Landing />;
  if (!userProfile.diagnostico) return <Navigate to="/diagnostico/setup" replace />;
  return <Dashboard />;
}

function App() {
  // Listener global de Firebase auth: hidrata sessionStore en login,
  // limpia en logout. Si Firebase no esta configurado, no hace nada y
  // se respeta el flujo legacy de localStorage.
  const { ready: authReady, status: authStatus } = useFirebaseAuth();
  const authError = useSessionStore((s) => s.authError);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-ink text-cream flex items-center justify-center">
        <p className="text-sm text-muted" role="status" aria-live="polite">
          Cargando tu sesión…
        </p>
      </div>
    );
  }
  if (authStatus === "error" && authError) {
    return <AuthErrorScreen message={authError} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/diagnostico/setup" element={<AuthGuard authStatus={authStatus}><DiagnosticoSetup /></AuthGuard>} />
        <Route path="/diagnostico" element={<AuthGuard authStatus={authStatus}><Diagnostico /></AuthGuard>} />
        <Route path="/diagnostico/perfil" element={<AuthGuard authStatus={authStatus}><DiagnosticoPerfil /></AuthGuard>} />
        <Route path="/diagnostico/recomendacion" element={<AuthGuard authStatus={authStatus}><DiagnosticoRecomendacion /></AuthGuard>} />

        <Route path="/" element={<Root />} />
        <Route path="/privacidad" element={<Privacidad />} />
        <Route path="/terminos" element={<Terminos />} />
        <Route path="/briefing" element={<OnboardingGuard authStatus={authStatus}><Briefing /></OnboardingGuard>} />
        <Route path="/simulation" element={<OnboardingGuard authStatus={authStatus}><Simulation /></OnboardingGuard>} />
        <Route path="/report" element={<OnboardingGuard authStatus={authStatus}><Report /></OnboardingGuard>} />
        <Route path="/mi-plan" element={<OnboardingGuard authStatus={authStatus}><MiPlan /></OnboardingGuard>} />
        {/* Banco de pruebas de prompts (solo texto), sin guard de onboarding */}
        <Route path="/chat-lab" element={<ChatLab />} />
        {/* Banco de pruebas de prompts POR VOZ (Gemini Live, sin video) */}
        <Route path="/voice-lab" element={<VoiceLab />} />
        {/* Ruta interna sin guard — solo para generar snapshots PNG de los GLBs */}
        <Route path="/__snapshot/:model" element={<AvatarSnapshot />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
