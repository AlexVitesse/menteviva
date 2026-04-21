import type { Avatar } from "../types";

/**
 * Avatar del entrevistador. No esta en /api/avatars (catalogo publico), pero el
 * backend lo reconoce por id. Exponerlo aqui permite reutilizar componentes de
 * avatar (AnimatedAvatar, etc.) sin fetch extra en /diagnostico.
 */
export const ENTREVISTADOR_AVATAR: Avatar = {
  id: "entrevistador",
  name: "Sofia",
  role: "Coach de Habilidades Blandas",
  company: "Mente Viva",
  personality:
    "Entrevistadora profesional. Calida, metodica, observadora. Escucha mucho mas de lo que habla.",
  voice: "es-MX-DaliaNeural",
  avatar_type: "animated",
};
