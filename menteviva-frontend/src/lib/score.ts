// Semaforo de puntajes del producto: verde > 75, amarillo 50-75, rojo < 50.
// Unica fuente para Report y Mi plan (antes cada pantalla tenia sus cortes).
export function scoreTone(score: number) {
  if (score > 75) return { text: "text-success", bg: "bg-success", label: "Sólido" };
  if (score >= 50) return { text: "text-warning", bg: "bg-warning", label: "En desarrollo" };
  return { text: "text-danger", bg: "bg-danger", label: "Por reforzar" };
}
