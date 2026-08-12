# Batería de Pruebas — Mente Viva (Piloto)

Documento para el equipo de pruebas. **No necesitas saber nada técnico.**
Solo sigue los pasos, fíjate en lo que pasa en la pantalla, y marca si funcionó
o no.

---

## 1. Antes de empezar

### ¿Qué es Mente Viva?

Es una plataforma donde practicas tus habilidades de comunicación **hablando con
personajes virtuales** (avatares). Primero tienes una entrevista con **Sofía**,
y después practicas conversaciones de ventas o negociación con **Roberto** o
**María**. Al final te dan una calificación.

Tu trabajo como tester es **usar la plataforma como un usuario normal** y avisar
cuando algo no funcione, se vea mal, o sea confuso.

### Qué necesitas

- Una **computadora** (de preferencia) con el navegador **Google Chrome**
  actualizado. *Navegador = el programa para abrir páginas de internet.*
- **Internet estable.**
- **Micrófono** (la mayoría de las laptops ya traen uno).
- **Audífonos o bocinas** para escuchar a los avatares.
- Un **celular** para algunas pruebas del final.

### El link del piloto

Abre esta dirección en Chrome:

```
https://varied-cattle-tables-shelter.trycloudflare.com
```

> ⚠️ Si el link deja de abrir o da error, **avísanos de inmediato** — la
> dirección puede cambiar y te pasaremos una nueva.

### El micrófono — paso a paso

La primera vez que entres a una entrevista, el navegador te va a preguntar si
permites usar el micrófono. **Tienes que decir que sí**, o los avatares no
podrán escucharte.

1. Cuando empieces una entrevista, arriba a la izquierda aparecerá un cuadrito
   que dice algo como *"localhost quiere usar tu micrófono"*.
2. Haz clic en **Permitir**.
3. Si por error le diste en *Bloquear*, haz clic en el **candado** 🔒 que está a
   la izquierda de la dirección web, busca *Micrófono* y cámbialo a *Permitir*.
   Luego recarga la página.

### Cómo tomar una captura de pantalla

Si algo falla, necesitamos una foto de lo que viste:

- **En computadora (Windows):** presiona las teclas `Windows` + `Shift` + `S`,
  selecciona el área, y se copia. Pégala en el reporte con `Ctrl` + `V`.
- **En celular:** normalmente se presionan a la vez el botón de *encendido* y el
  de *bajar volumen*.

---

## 2. Cómo reportar un problema

Cuando algo falle, mándanos esto (entre más detalle, mejor):

| Campo | Qué poner |
|---|---|
| **Número de prueba** | El código de la prueba, ej. "P2.3" |
| **Qué estaba haciendo** | "Estaba hablando con Sofía y..." |
| **Qué esperaba que pasara** | "Esperaba que me respondiera" |
| **Qué pasó en realidad** | "La pantalla se quedó congelada" |
| **Captura de pantalla** | La foto de lo que viste |
| **Dispositivo** | "Laptop con Chrome" o "Celular Samsung" |

Hay una plantilla lista para copiar al final de este documento (sección 8).

---

## 3. Cómo usar este documento

Cada prueba tiene un código (P1.1, P1.2, …) y tres partes:

- **Qué hacer:** los pasos exactos que debes seguir.
- **Qué debe pasar:** lo que deberías ver si todo está bien.
- **Resultado:** marca una casilla y escribe notas si algo falló.

Marca así:
- ✅ **Funcionó** — pasó exactamente lo esperado.
- ⚠️ **Funcionó pero raro** — funcionó, pero algo se vio mal, fue lento o confuso.
- ❌ **Falló** — no pasó lo esperado.

> Si no entiendes una prueba o no sabes si algo "está bien", **eso también es un
> hallazgo** — anótalo. Si te confunde a ti, confunde al usuario final.

---

## 4. Las pruebas

### BLOQUE 1 — Crear cuenta e iniciar sesión

---

**P1.1 — Abrir el sitio por primera vez**

*Qué hacer:*
1. Abre el link del piloto en Chrome.

*Qué debe pasar:* Carga una página de presentación de Mente Viva (la "landing"),
con textos, imágenes y un botón para empezar o crear cuenta. No debe salir
ningún error ni pantalla en blanco.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.2 — Crear una cuenta nueva**

*Qué hacer:*
1. Busca y haz clic en el botón para **crear cuenta** o **registrarte**.
2. Llena el formulario: nombre, correo electrónico, contraseña.
3. Vuelve a escribir la misma contraseña en *Confirmar contraseña*.
4. Llena tu rol objetivo (ej. "Vendedor"), industria (ej. "Tecnología") y nivel
   de experiencia.
5. Haz clic en **Crear cuenta y continuar**.

*Qué debe pasar:* La página te lleva a una pantalla de bienvenida que dice
*"Hola, [tu nombre]"* y empieza a preparar tu entrevista.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.3 — La contraseña te avisa si es débil**

*Qué hacer:*
1. En el formulario de crear cuenta, escribe una contraseña muy corta (ej. "123").

*Qué debe pasar:* Aparece un aviso de que la contraseña es débil o muy corta, y
no te deja continuar hasta usar una mejor.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.4 — Las contraseñas que no coinciden**

*Qué hacer:*
1. En crear cuenta, escribe una contraseña.
2. En *Confirmar contraseña*, escribe una **diferente**.

*Qué debe pasar:* La página te avisa que las contraseñas no coinciden y no te
deja continuar.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.5 — Ver la contraseña**

*Qué hacer:*
1. En el campo de contraseña, escribe algo.
2. Haz clic en el ícono de ojo 👁 que está dentro del campo.

*Qué debe pasar:* La contraseña se muestra como texto normal; al hacer clic de
nuevo, se vuelve a ocultar con puntitos.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.6 — Crear cuenta con un correo ya registrado**

*Qué hacer:*
1. Intenta crear una cuenta usando el **mismo correo** que ya usaste en P1.2.

*Qué debe pasar:* La página te avisa que ese correo ya está registrado. No crea
una cuenta duplicada.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.7 — Cerrar sesión**

*Qué hacer:*
1. Estando dentro de la plataforma, busca tu nombre o foto (arriba a la derecha).
2. Haz clic ahí y elige **Cerrar sesión**.

*Qué debe pasar:* Te saca de tu cuenta y te regresa a la pantalla de inicio o de
inicio de sesión.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.8 — Iniciar sesión con correo y contraseña**

*Qué hacer:*
1. En la pantalla de inicio de sesión, escribe el correo y la contraseña de la
   cuenta que creaste.
2. Haz clic en **Iniciar sesión**.

*Qué debe pasar:* Entras directamente a tu panel o a donde te quedaste, sin tener
que volver a hacer la entrevista.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.9 — Iniciar sesión con contraseña equivocada**

*Qué hacer:*
1. Intenta iniciar sesión con tu correo correcto pero una contraseña incorrecta.

*Qué debe pasar:* Aparece un mensaje claro de que el correo o la contraseña son
incorrectos. No te deja entrar.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P1.10 — Iniciar sesión con Google**

*Qué hacer:*
1. En la pantalla de inicio de sesión, busca el botón de **Google**.
2. Elige tu cuenta de Google.

*Qué debe pasar:* Entras a la plataforma sin escribir contraseña. Si tu cuenta de
Google tiene foto, esa foto aparece arriba a la derecha.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 2 — La entrevista con Sofía

> Sofía es la entrevistadora virtual. Te hace preguntas y tú le respondes
> **hablando en voz alta**.

---

**P2.1 — Preparar la entrevista**

*Qué hacer:*
1. Después de crear tu cuenta, llegas a una pantalla de preparación.
2. Revisa las opciones: idioma, tono de voz, duración.
3. Deja las opciones recomendadas y haz clic en **Comenzar diagnóstico**.

*Qué debe pasar:* Pasa a una pantalla que te dice que vas a empezar y te pide
permiso para el micrófono.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.2 — Dar permiso al micrófono**

*Qué hacer:*
1. Haz clic en **Iniciar entrevista**.
2. Cuando el navegador pregunte por el micrófono, haz clic en **Permitir**.

*Qué debe pasar:* La entrevista empieza. Aparece Sofía en pantalla.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.3 — Sofía te saluda con voz**

*Qué hacer:*
1. Espera unos segundos después de que empieza la entrevista.

*Qué debe pasar:* Sofía dice un saludo **en voz alta** (lo escuchas por las
bocinas) y el saludo también aparece escrito en el chat.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.4 — Sofía te escucha cuando hablas**

*Qué hacer:*
1. Cuando Sofía termine de hablar, **responde en voz alta** con una frase
   completa (ej. "Hola Sofía, soy vendedor y quiero mejorar mi comunicación").
2. Quédate en silencio un momento al terminar.

*Qué debe pasar:* Lo que dijiste aparece escrito en el chat, y después Sofía
responde con una nueva pregunta o comentario, hablando en voz alta.

> ⚠️ Sofía puede tardar varios segundos en responder. Eso ya lo sabemos
> (ver sección 6). Solo repórtalo si tarda **más de 1 minuto** o si **nunca**
> responde.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.5 — La boca del avatar se mueve al hablar**

*Qué hacer:*
1. Mientras Sofía habla, observa su cara.

*Qué debe pasar:* La boca del avatar se mueve más o menos al ritmo de lo que
dice. La cara se ve normal, no congelada ni deformada.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.6 — Silenciar el audio del avatar**

*Qué hacer:*
1. Durante la entrevista, busca el botón de **silenciar** (un ícono de bocina).
2. Haz clic para silenciar.

*Qué debe pasar:* Dejas de escuchar a Sofía, pero la conversación sigue (su texto
sigue apareciendo en el chat). Al hacer clic de nuevo, vuelve el sonido.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.7 — Apagar y encender la cámara**

*Qué hacer:*
1. Busca el botón de **cámara/video** y haz clic para apagarla, luego encenderla.

*Qué debe pasar:* El recuadro de tu cámara se apaga y enciende. La entrevista no
se interrumpe.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.8 — Tener una conversación completa con Sofía**

*Qué hacer:*
1. Responde **al menos 5 preguntas** de Sofía, hablando con normalidad.
2. Sé honesto y da respuestas reales, como lo haría un usuario.

*Qué debe pasar:* La conversación fluye: Sofía pregunta, tú respondes, ella
reacciona. Las respuestas de Sofía tienen sentido con lo que dijiste.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P2.9 — Terminar la entrevista y ver tu perfil**

*Qué hacer:*
1. Después de varias respuestas, haz clic en el botón **Terminar**.

*Qué debe pasar:* La plataforma procesa unos segundos y te muestra un **perfil**
con tus fortalezas y áreas a mejorar, y luego una **recomendación** de con qué
avatar practicar.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 3 — Practicar con Roberto y María

> Después de la entrevista llegas a tu **panel**, donde eliges con quién
> practicar.

---

**P3.1 — Ver el panel y elegir un avatar**

*Qué hacer:*
1. Después de la entrevista (o al iniciar sesión), llega a tu panel.
2. Observa las tarjetas de los avatares disponibles (Roberto, María).

*Qué debe pasar:* Se ven las tarjetas con foto, nombre y descripción de cada
avatar. Las tarjetas están parejas (mismo tamaño) y bien acomodadas.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.2 — Entrar al briefing de Roberto**

*Qué hacer:*
1. Haz clic en la tarjeta de **Roberto**.

*Qué debe pasar:* Llegas a una pantalla de "briefing" que explica el escenario:
quién es Roberto, el objetivo de la práctica, y opciones de dificultad.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.3 — Elegir el nivel de dificultad de Roberto**

*Qué hacer:*
1. En el briefing de Roberto, busca los niveles: **Principiante**,
   **Intermedio**, **Avanzado**.
2. Lee la descripción de cada uno y selecciona **Principiante**.

*Qué debe pasar:* Puedes seleccionar el nivel y se marca como elegido. Cada nivel
tiene una descripción distinta.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.4 — Iniciar la práctica con Roberto**

*Qué hacer:*
1. En el briefing, haz clic en el botón para **empezar la práctica**.
2. Da permiso al micrófono si lo pide.

*Qué debe pasar:* Empieza la conversación. Aparece Roberto y te saluda con voz.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.5 — Conversar con Roberto**

*Qué hacer:*
1. Habla con Roberto como si le estuvieras vendiendo algo. Responde al menos
   **5 veces**.

*Qué debe pasar:* Roberto responde como un cliente: pone objeciones, hace
preguntas. Tu voz se transcribe en el chat y él reacciona a lo que dices.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.6 — El cronómetro de la práctica**

*Qué hacer:*
1. Durante la práctica, observa el cronómetro/tiempo en la pantalla.

*Qué debe pasar:* El tiempo avanza normalmente mientras dura la sesión.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.7 — Practicar con María**

*Qué hacer:*
1. Regresa al panel y elige a **María**.
2. Haz su briefing y una conversación de al menos 5 respuestas.

*Qué debe pasar:* María funciona igual que Roberto, pero su escenario es de
negociación. Responde con coherencia a lo que dices.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P3.8 — Probar el nivel Avanzado de Roberto**

*Qué hacer:*
1. Empieza otra práctica con Roberto, esta vez en nivel **Avanzado**.
2. Conversa con él unas 5 veces.

*Qué debe pasar:* Roberto se comporta más exigente y difícil que en
Principiante. La práctica funciona sin errores.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 4 — Tu reporte y calificación

---

**P4.1 — Ver el reporte al terminar una práctica**

*Qué hacer:*
1. Al terminar una práctica con Roberto o María, haz clic en **Terminar**.

*Qué debe pasar:* Después de procesar unos segundos, aparece un reporte con tu
**calificación** y un análisis de cómo te fue.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P4.2 — El semáforo de la calificación**

*Qué hacer:*
1. Observa el color de tu calificación general en el reporte.

*Qué debe pasar:* El color tiene sentido con el número:
- Verde si la calificación es alta.
- Amarillo si es media.
- Rojo si es baja.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P4.3 — Los detalles del reporte (6 indicadores)**

*Qué hacer:*
1. En el reporte, revisa la lista de habilidades o indicadores evaluados.

*Qué debe pasar:* Aparecen varios indicadores con su puntaje y comentario. Los
textos se leen completos, no están cortados ni encimados.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P4.4 — Compartir el reporte**

*Qué hacer:*
1. Busca el botón de **compartir** en el reporte.
2. Ábrelo y prueba una de las opciones (ej. copiar enlace).

*Qué debe pasar:* Se abre un menú con opciones para compartir (redes sociales,
copiar). La opción que elijas funciona.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 5 — Tu panel y tu historial

---

**P5.1 — Ver tu historial de sesiones**

*Qué hacer:*
1. Después de hacer al menos 2 prácticas, ve a la sección **Mi Plan** o tu
   historial.

*Qué debe pasar:* Aparecen las sesiones que hiciste, con fecha y calificación.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P5.2 — Tu progreso se guarda al volver a entrar**

*Qué hacer:*
1. Cierra sesión.
2. Vuelve a iniciar sesión con la misma cuenta.
3. Revisa tu historial.

*Qué debe pasar:* Tus sesiones anteriores siguen ahí. No se perdió nada.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P5.3 — Moverte por el menú**

*Qué hacer:*
1. Usa el menú para ir entre el panel, tu plan y otras secciones.

*Qué debe pasar:* La navegación funciona, no te lleva a páginas en blanco ni a
errores.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 6 — Probar en el celular

> Repite las pruebas clave en un celular. El micrófono **solo funciona** porque
> el sitio usa una dirección segura (empieza con `https`).

---

**P6.1 — Abrir el sitio en el celular**

*Qué hacer:*
1. Abre el link del piloto en el navegador de tu celular (Chrome).

*Qué debe pasar:* El sitio se ve bien adaptado a la pantalla del celular. Los
textos y botones se leen y se pueden tocar sin problemas.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P6.2 — Crear cuenta o iniciar sesión en el celular**

*Qué hacer:*
1. Crea una cuenta o inicia sesión desde el celular.

*Qué debe pasar:* El formulario funciona igual que en la computadora.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P6.3 — Hablar con un avatar desde el celular**

*Qué hacer:*
1. Inicia una entrevista o práctica en el celular.
2. Da permiso al micrófono.
3. Habla con el avatar al menos 3 veces.

*Qué debe pasar:* El avatar te escucha y responde con voz, igual que en la
computadora.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

### BLOQUE 7 — Situaciones raras (pruebas de estrés)

> Aquí probamos qué pasa cuando el usuario hace algo inesperado.

---

**P7.1 — Cerrar la pestaña a media conversación**

*Qué hacer:*
1. Empieza una práctica, conversa 2 veces.
2. Cierra la pestaña del navegador de golpe.
3. Vuelve a abrir el sitio e inicia sesión.

*Qué debe pasar:* El sitio no se rompe. Puedes volver a entrar y usar la
plataforma normalmente.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P7.2 — Responder con frases muy cortas o sin sentido**

*Qué hacer:*
1. En una entrevista, responde con cosas muy cortas ("sí", "no", "mmm") o que no
   tengan que ver con la pregunta.

*Qué debe pasar:* El avatar maneja la situación con naturalidad: te vuelve a
preguntar o te pide que desarrolles. No se rompe ni se queda callado para
siempre.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P7.3 — Quedarte callado**

*Qué hacer:*
1. En una entrevista, cuando el avatar termine de hablar, **no digas nada** por
   un rato.

*Qué debe pasar:* La plataforma espera tu respuesta sin romperse. No envía una
respuesta vacía ni se congela.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P7.4 — Terminar una sesión casi de inmediato**

*Qué hacer:*
1. Empieza una práctica y haz clic en **Terminar** después de solo 1 respuesta
   (o sin responder).

*Qué debe pasar:* La plataforma maneja la sesión corta sin romperse. Puede
avisarte que la sesión fue muy corta para evaluar, pero no debe quedarse colgada.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P7.5 — Entrar directo a una página sin haber iniciado sesión**

*Qué hacer:*
1. Cierra sesión.
2. Intenta abrir directamente el panel o el reporte (si tienes el link o lo
   escribes en la barra de direcciones).

*Qué debe pasar:* La plataforma te manda a iniciar sesión en lugar de mostrarte
contenido al que no deberías tener acceso.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

**P7.6 — Internet lento o inestable**

*Qué hacer:*
1. Si puedes, conéctate a un internet lento (o aléjate del WiFi) y usa la
   plataforma.

*Qué debe pasar:* Puede ir más lento, pero no debe romperse con errores raros.
Si algo falla, debería avisarte con un mensaje claro.

*Resultado:* [ ] ✅  [ ] ⚠️  [ ] ❌
*Notas:* ______________________________________________

---

## 5. Prueba rápida de 10 minutos

Cuando solo tengas poco tiempo, o para revisar rápido después de un cambio, haz
este recorrido corto. Si los 6 pasos funcionan, lo esencial está bien:

1. [ ] Abrir el sitio — carga sin error.
2. [ ] Iniciar sesión con una cuenta existente.
3. [ ] Entrar a una práctica con Roberto y hablar 2 veces — te escucha y responde.
4. [ ] Terminar la práctica — aparece el reporte con calificación.
5. [ ] Revisar el historial en Mi Plan — aparece la sesión que acabas de hacer.
6. [ ] Cerrar sesión — te saca correctamente.

---

## 6. Cosas que YA sabemos (no las reportes como nuevas)

Estos puntos ya los conocemos y estamos trabajando en ellos. **No hace falta que
los reportes**, salvo que sean mucho peores de lo descrito:

- **Los avatares tardan en responder.** Sofía, Roberto y María pueden tardar
  varios segundos (a veces más) en contestar. Estamos por mejorar la velocidad.
  *Solo repórtalo si tarda más de 1 minuto o si nunca responde.*
- **El link puede cambiar.** La dirección del piloto puede cambiar de un día a
  otro. Si deja de funcionar, te pasaremos una nueva — no es un bug.
- **Sofía a veces se despide algo brusco.** Puede decir "te haré una última
  pregunta" y cerrar sin hacerla. Ya está identificado.

---

## 7. Glosario (los pocos términos que necesitas)

| Término | Qué significa |
|---|---|
| **Navegador** | El programa para abrir páginas de internet. Usa Google Chrome. |
| **Avatar** | El personaje virtual con el que hablas (Sofía, Roberto, María). |
| **Diagnóstico** | La entrevista inicial con Sofía. |
| **Práctica / Simulación** | La conversación de entrenamiento con Roberto o María. |
| **Briefing** | La pantalla que explica el escenario antes de empezar a practicar. |
| **Reporte** | La pantalla final con tu calificación y análisis. |
| **Captura de pantalla** | Una foto de lo que se ve en tu pantalla. |
| **Iniciar / Cerrar sesión** | Entrar a tu cuenta / salir de tu cuenta. |

---

## 8. Plantilla de reporte de bug (copia y llena)

```
NÚMERO DE PRUEBA:  (ej. P2.4, o "ninguna" si lo encontraste por tu cuenta)
RESULTADO:         ⚠️ Funcionó pero raro  /  ❌ Falló

QUÉ ESTABA HACIENDO:
(ej. "Estaba hablando con Roberto en nivel Avanzado")

QUÉ ESPERABA QUE PASARA:
(ej. "Que me respondiera con voz")

QUÉ PASÓ EN REALIDAD:
(ej. "La pantalla se quedó congelada y no respondió")

¿SE PUEDE REPETIR?:  Sí / No / No sé

DISPOSITIVO Y NAVEGADOR:
(ej. "Laptop Windows con Chrome" / "Celular Samsung con Chrome")

CAPTURA DE PANTALLA:  (adjunta la imagen)

NOTAS EXTRA:
```

---

## Resumen de avance del tester

Llena esto al final de tu jornada de pruebas:

| Bloque | Pruebas hechas | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| 1 — Cuenta y sesión | / 10 | | | |
| 2 — Entrevista con Sofía | / 9 | | | |
| 3 — Práctica Roberto/María | / 8 | | | |
| 4 — Reporte | / 4 | | | |
| 5 — Panel e historial | / 3 | | | |
| 6 — Celular | / 3 | | | |
| 7 — Situaciones raras | / 6 | | | |

**Comentario general del tester:**
______________________________________________________________
______________________________________________________________
