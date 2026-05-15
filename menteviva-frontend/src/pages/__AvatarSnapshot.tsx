import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { TalkingHeadAvatar } from "../components/avatar/TalkingHeadAvatar";

/**
 * Ruta interna SOLO para generar PNGs de los GLBs.
 * Renderiza el avatar a 512×512 sobre fondo transparente.
 *
 * Uso: navegar a /__snapshot/<modelName> donde modelName es el archivo
 * sin extension dentro de /public/avatars/. Ej:
 *   /__snapshot/avatarsdk
 *   /__snapshot/sofia
 *
 * Capturar el div #avatar-snapshot con chrome-devtools y guardar como
 * /public/avatars/<id>.png. Esta ruta no se incluye en el flujo de usuario.
 */
export function AvatarSnapshot() {
  const { model } = useParams<{ model: string }>();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const url = `/avatars/${model}.glb`;

  // Forzar bg transparente en html/body para que la captura del canvas
  // (alpha:true) salga sin el bg-ink del resto del app.
  useEffect(() => {
    const prevHtmlBg = document.documentElement.style.background;
    const prevBodyBg = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = prevHtmlBg;
      document.body.style.background = prevBodyBg;
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        id="avatar-snapshot"
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <TalkingHeadAvatar
          audioRef={audioRef}
          isSpeaking={false}
          modelUrl={url}
          // avatarsdk es Roberto (masculine). El resto (avaturn=Maria, sofia)
          // son feminine por default.
          gender={model === "avatarsdk" ? "masculine" : "feminine"}
        />
      </div>
    </div>
  );
}
