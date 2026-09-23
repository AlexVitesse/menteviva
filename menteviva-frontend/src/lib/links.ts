import { CONTACTO } from "../pages/Legal"

// Cuando exista el link de Cal.com/Calendly va en VITE_DEMO_URL; mientras, mailto.
export const DEMO_HREF =
  import.meta.env.VITE_DEMO_URL || `mailto:${CONTACTO}?subject=Demo%20de%20Mente%20Viva`
