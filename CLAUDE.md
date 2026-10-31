# Cundapol

App para llevar la cuenta de quién lleva el coche en una cunda (turnos para compartir coche al trabajo).
Todo en español: interfaz, nombres de variables y funciones, comentarios y mensajes de commit.

## Cómo está hecha

- Web estática sin build: `index.html`, `style.css`, `app.js` (módulo ES), `sw.js`, `version.js`.
- Firebase (proyecto `cundapol`) cargado desde el CDN de gstatic (10.14.1): Auth (Google y correo) y Firestore con caché persistente.
- Se publica en GitHub Pages desde `main`: https://gaepmalaga.github.io/cundapol/ (tarda 1-2 min tras fusionar).
- PWA instalable. El service worker (`sw.js`) va primero a la red para lo propio y tira de caché sin cobertura.

## Datos (Firestore)

- `cundas/{cid}`: `nombre`, `admin` (uid), `uids` (quién está dentro), `codigo` (del enlace de invitación), `invitacion` (último código usado al unirse), `sincronizado` (solo en la "original").
  - `miembros/{pid}`: `nombre`, `uid` (nulo = hueco sin cuenta), `fuera` (salió o lo echaron: su historial se ve pero no cuenta para la media), `legado` (solo en la "original").
  - `viajes/{id}`: `persona` (pid), `dia` (AAAA-MM-DD), `n` (1, o ±N si es ajuste), `tipo` (`viaje`/`ajuste`), `por` (uid de quien lo apuntó), `creado`.
- `perfiles/{uid}`: `nombre`, y `persona` en los cuatro de siempre.
- `viajes/{id}` (en la raíz): la colección de antes del multiusuario. Ver «Pendiente».

- **Vacaciones** (aparte de Kundapol, en `vacaciones.html` + `vacaciones.js`, con su `vacaciones.webmanifest`; mismo Firebase, mismo `style.css` y mismo `sw.js`):
  - `turnos/{tid}`: `nombre`, `inicio` (AAAA-MM-DD, primer día de trabajo de una tanda), `admin` (uid), `uids`, `codigo`, `invitacion`.
    - `miembros/{uid}`: `nombre` (el de `perfiles`).
    - `dias/{uid}_{día}`: `uid`, `dia`. Cada uno apunta y quita solo los suyos (el admin también quita).
  - Se trabajan 6 días y se libran 6 desde `inicio`; la app calcula qué días son de trabajo y solo deja marcar esos. Sin máximo de gente por día. Recuento por persona y año.
  - Mismo funcionamiento que las cundas: crea el admin, enlace `#unirse=<tid>.<codigo>`, echar, pasar el turno, salirse.

## Funcionamiento

- Todos tienen cuenta. Una cuenta puede estar en varias cundas.
- Quien crea la cunda es el admin. Invita con un enlace `#unirse=<cid>.<codigo>`.
- El admin puede cambiar el nombre, pasar la cunda a otro de dentro, echar a alguien (al hacerlo cambia el código del enlace) y quitar cualquier viaje.
- Los demás quitan solo lo que apuntaron ellos y pueden salirse. El admin no puede salirse sin pasar antes la cunda.
- Cunda "original": la de Silvia, María, Curro y Christian, con **Christian de admin**.
  - Se creó sola al entrar el primero de los cuatro.
  - Sus miembros conservan los ids de siempre (`silvia`, `maria`, `curro`, `christian`).
  - Quien aún no tenga cuenta es un hueco que reclama al entrar con el enlace («¿Eres alguno de estos?»).
  - Lo que se apunte en la colección vieja se copia solo a la original (`sincronizarOriginal`). Las reglas solo aceptan copias idénticas apuntadas por gente de dentro.

## Reglas de Firestore

- `firestore.rules` es la fuente. **No hay acceso a Firebase desde aquí**: las publica el usuario a mano, en Firebase Console → Firestore → Reglas → Publicar.
- Cuando cambien, pasarle el archivo entero en un bloque de código para copiar y pegar.
- Hacer que las reglas nuevas sigan funcionando con la versión de la app que ya está publicada. Así el usuario las publica primero y luego se fusiona el PR.

## Versiones

- **En cada cambio que se publique, subir `VERSION` en `version.js`.** La app enseña «Versión N» abajo. Si la publicada es más nueva, sale arriba «Hay una versión nueva» con el botón «Actualizar». Se mira al abrir, al volver a la app y cada 30 minutos.
- No hay recarga automática: cada uno actualiza con el botón. Abrir la app desde cero ya carga lo último.
- `CACHE` en `sw.js` no hace falta tocarlo para actualizar. Subirlo solo si se quiere vaciar la caché vieja de los móviles.

## Cómo trabajar

- Hablar con el usuario antes de cambios grandes o de diseño. Una vez dado el visto bueno, hacerlo de principio a fin.
- Flujo: rama → PR → fusionar a `main`. El usuario quiere que lo fusione Claude. Si el PR cambia reglas, esperar antes a que el usuario confirme que las ha publicado.
- Después de fusionar, comprobar que GitHub Pages sirve lo nuevo, por ejemplo con `curl` a `version.js`.
- Probar antes de subir, con el emulador de Firestore (Java y npm están disponibles). Las pruebas no se guardan en el repo; se rehacen en el scratchpad:
  - **Reglas:** `firebase-tools`, `@firebase/rules-unit-testing` y `firebase`, ejecutadas con `firebase emulators:exec --only firestore`. En `initializeTestEnvironment` pasar siempre el `firestore.rules` real: si no, carga otras reglas en el emulador.
  - **App de punta a punta:** Playwright, con Chromium en `/opt/pw-browsers`. Servir el repo con `python3 -m http.server`. Interceptar `app.js` con `route` para conectarlo a los emuladores de Auth y Firestore (`connectAuthEmulator` y `connectFirestoreEmulator`) y cambiar `projectId` a `demo-cunda`. Crear los usuarios por la API REST del emulador de Auth.
  - Al parar el servidor, `pkill -f "http.server 800[0]"`, con el corchete para no matar la propia shell.

## Pendiente

1. **Cerrar la colección vieja `viajes`.** Hacerlo cuando a Silvia, María y Curro les salga «gente» en la cabecera, señal de que ya tienen la versión nueva. En las reglas, el bloque final `match /viajes/{id}` pasa de `allow read, create, delete: if entrado(); allow update: if false;` a `allow read: if entrado(); allow write: if false;`. Después, quitar `sincronizarOriginal` de la app y la regla de `sincronizado`/`copiaFiel`.
2. Que Christian confirme que los números de la original cuadran con los de antes (salieron 12, 12, 12 y 13). Si no, se corrige con «Ajustar cuentas».

## Ideas aparcadas (el usuario no las quiere de momento)

- «Mañana le toca a…»
- Aviso de viaje repetido el mismo día
- Quién iba en el coche
- Resumen por meses
- Recordatorio diario con notificación (necesita el plan de pago por uso de Firebase)
- Kilómetros y gasolina
- Bono energético (CAE) como Tribbu: haría falta un sujeto delegado, verificar viajes con GPS y kilómetros, y bastante volumen. Lo práctico ahora es usar Tribbu a la vez para cobrarlo.
