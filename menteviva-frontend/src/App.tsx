import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Briefing } from "./pages/Briefing";
import { Simulation } from "./pages/Simulation";
import { Report } from "./pages/Report";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/briefing" element={<Briefing />} />
        <Route path="/simulation" element={<Simulation />} />
        <Route path="/report" element={<Report />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
