import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

// TODO: confirmar la direccion de contacto publica antes del piloto abierto.
export const CONTACTO = "contacto@i-condor.com";

const ACTUALIZADO = "19 de agosto de 2026";

/**
 * Paginas legales del sitio publico. Las dos viven aqui porque comparten
 * layout y se enlazan mutuamente desde el footer; separarlas solo duplicaria
 * el marco.
 */
function LegalLayout({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <main className="min-h-[100dvh] bg-ink px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-cream"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>

        <h1 className="font-syne mt-8 text-3xl font-bold tracking-tight text-cream sm:text-4xl">
          {titulo}
        </h1>
        <p className="mt-2 text-sm text-muted">Última actualización: {ACTUALIZADO}</p>

        <div className="mt-10 space-y-8 leading-relaxed text-muted">{children}</div>
      </div>
    </main>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-syne mb-3 text-xl font-bold text-cream">{titulo}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Privacidad() {
  return (
    <LegalLayout titulo="Aviso de privacidad">
      <p>
        Mente Viva es una plataforma de entrenamiento de habilidades blandas mediante conversaciones
        con avatares de inteligencia artificial. Para funcionar necesita procesar tu voz y el
        contenido de esas conversaciones. Este aviso explica qué se guarda, dónde y por cuánto
        tiempo.
      </p>

      <Seccion titulo="Qué datos tratamos">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-cream">Datos de cuenta:</strong> nombre, correo electrónico,
            rol objetivo, industria y nivel de experiencia. Los proporcionas tú al registrarte.
          </li>
          <li>
            <strong className="text-cream">Audio de las sesiones:</strong> lo que dices durante una
            simulación se envía a un servicio de transcripción y se convierte en texto.
          </li>
          <li>
            <strong className="text-cream">Transcripciones y reportes:</strong> el texto de la
            conversación y el análisis de desempeño que genera la plataforma.
          </li>
          <li>
            <strong className="text-cream">Datos técnicos:</strong> registros de servidor con fecha,
            ruta solicitada y dirección IP, para operar y diagnosticar el servicio.
          </li>
        </ul>
      </Seccion>

      <Seccion titulo="Qué pasa con tu voz">
        <p>
          El audio se transmite para ser transcrito y, una vez convertido a texto, no se conserva
          como archivo de audio. Lo que sí se guarda es la transcripción, porque es la base del
          reporte que recibes. Si no quieres que se guarde la transcripción de una sesión, puedes
          solicitar su eliminación escribiendo a{" "}
          <a href={`mailto:${CONTACTO}`} className="text-violet-light hover:underline">
            {CONTACTO}
          </a>
          .
        </p>
      </Seccion>

      <Seccion titulo="Con quién se comparte">
        <p>
          Mente Viva no vende ni cede tus datos. Para operar se apoya en proveedores que actúan como
          encargados del tratamiento:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Proveedores de modelos de lenguaje y de voz, para transcribir, generar las respuestas del avatar y sintetizar su voz.</li>
          <li>Un proveedor de base de datos gestionada, donde se almacenan cuenta, transcripciones y reportes.</li>
          <li>Un proveedor de autenticación, que gestiona el inicio de sesión.</li>
        </ul>
        <p>
          Puedes solicitar la lista nominal y vigente de estos proveedores, junto con su ubicación de
          procesamiento, escribiendo a la dirección de contacto.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo se conserva">
        <p>
          Los datos de cuenta se conservan mientras la cuenta esté activa. Las transcripciones y
          reportes se conservan mientras sigan siendo útiles para mostrarte tu progreso, y se
          eliminan al cerrar la cuenta o cuando lo solicites. Los registros técnicos rotan de forma
          automática.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>
          Puedes solicitar acceso, rectificación, cancelación u oposición sobre tus datos, así como
          la exportación de tus transcripciones y reportes, escribiendo a{" "}
          <a href={`mailto:${CONTACTO}`} className="text-violet-light hover:underline">
            {CONTACTO}
          </a>
          . La solicitud se atiende dentro de los plazos que marque la legislación aplicable.
        </p>
      </Seccion>

      <Seccion titulo="Uso en empresas">
        <p>
          Cuando una organización contrata Mente Viva para su equipo, la organización define quién
          tiene acceso a los reportes agregados. El detalle de una conversación individual no se
          comparte con la organización salvo que la persona lo autorice de forma expresa. Las
          condiciones concretas se fijan en el contrato con cada organización.
        </p>
      </Seccion>

      <Seccion titulo="Estado del servicio">
        <p>
          Mente Viva se encuentra en fase piloto. Las prácticas descritas aquí pueden cambiar
          conforme evolucione la plataforma; los cambios relevantes se comunicarán a las personas
          registradas antes de entrar en vigor.
        </p>
      </Seccion>
    </LegalLayout>
  );
}

export function Terminos() {
  return (
    <LegalLayout titulo="Términos de uso">
      <p>
        Al usar Mente Viva aceptas estos términos. Si usas la plataforma en nombre de una
        organización, confirmas que tienes autorización para hacerlo.
      </p>

      <Seccion titulo="Qué es el servicio">
        <p>
          Mente Viva permite practicar conversaciones de trabajo (ventas, negociación, entrevistas)
          con avatares de inteligencia artificial y recibir un reporte de desempeño. Es una
          herramienta de entrenamiento y práctica.
        </p>
      </Seccion>

      <Seccion titulo="Qué no es">
        <p>
          El reporte de desempeño es orientativo. No constituye una evaluación psicológica, un
          diagnóstico clínico, asesoría legal o laboral, ni una certificación profesional. No debe
          usarse como único criterio para decisiones de contratación, promoción o desvinculación.
        </p>
      </Seccion>

      <Seccion titulo="Uso aceptable">
        <ul className="list-disc space-y-2 pl-5">
          <li>No compartas tu cuenta ni tus credenciales.</li>
          <li>No introduzcas datos personales sensibles de terceros durante las sesiones.</li>
          <li>No uses la plataforma para acosar, suplantar identidades ni generar contenido ilícito.</li>
          <li>No intentes extraer, replicar ni revender los modelos, prompts o contenidos del servicio.</li>
        </ul>
      </Seccion>

      <Seccion titulo="Contenido generado por IA">
        <p>
          Las respuestas de los avatares y los análisis los genera un modelo de lenguaje y pueden
          contener errores. Revisa siempre la información antes de actuar sobre ella.
        </p>
      </Seccion>

      <Seccion titulo="Disponibilidad">
        <p>
          Durante la fase piloto el servicio se ofrece tal cual, sin compromiso de disponibilidad
          continua. Puede haber interrupciones por mantenimiento o por fallas de los proveedores en
          los que se apoya.
        </p>
      </Seccion>

      <Seccion titulo="Cuentas y cancelación">
        <p>
          Puedes cerrar tu cuenta en cualquier momento escribiendo a{" "}
          <a href={`mailto:${CONTACTO}`} className="text-violet-light hover:underline">
            {CONTACTO}
          </a>
          . Podemos suspender una cuenta que incumpla estos términos, avisando por correo cuando sea
          posible.
        </p>
      </Seccion>

      <Seccion titulo="Contacto">
        <p>
          Para cualquier duda sobre estos términos:{" "}
          <a href={`mailto:${CONTACTO}`} className="text-violet-light hover:underline">
            {CONTACTO}
          </a>
          .
        </p>
      </Seccion>
    </LegalLayout>
  );
}
