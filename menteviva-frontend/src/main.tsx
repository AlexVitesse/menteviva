import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Nota: no envolvemos en <React.StrictMode>. La libreria @ricky0123/vad-react
// tiene una race condition en el double-invoke de StrictMode: el cleanup del
// primer effect dispara destroy() sobre un MicVAD cuyo audio nunca se inicio,
// y destroy() tira "MicVAD has null stream, audio context, or processor adapter".
// En produccion React no hace el double-invoke, asi que el bug no aparece, pero
// en dev (o en tunnels apuntando al dev server desde movil) si.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
