# Cundapol

App para llevar la cuenta de quién lleva el coche en una cunda (turnos para compartir coche al trabajo).
Todo en español: interfaz, nombres de variables y funciones, comentarios y mensajes de commit.

## Cómo está hecha

- Web estática sin build: `index.html`, `style.css`, `app.js` (módulo ES), `sw.js`, `version.js`.
- Firebase (proyecto `cundapol`) cargado desde el CDN de gstatic (10.14.1): Auth (Google, correo o usuario) y Firestore con caché persistente.
- **Entrar con usuario:** quien no quiere dar su correo pone un usuario sin `@`; por dentro es `usuario@usuario.invalid` (un correo que no existe), así que esas cuentas **no pueden recuperar la contraseña**. «He olvidado mi contraseña» manda el correo de Firebase (en español) solo a quien se registró con correo real. Mismo código en `app.js` y `vacaciones.js`.
- Se publica en GitHub Pages desde `main`: https://gaepmalaga.github.io/cundapol/ (tarda 1-2 min tras fusionar).
- PWA instalable. El service worker (`sw.js`) va primero a la red para lo propio y tira de caché sin cobertura.

## Datos (Firestore)

- `cundas/{cid}`: `nombre`, `admin` (uid), `uids` (quién está dentro), `codigo` (del enlace de invitación), `invitacion` (último código usado al unirse), `sincronizado` (solo en la "original").
  - `miembros/{pid}`: `nombre`, `uid` (nulo = hueco sin cuenta), `fuera` (salió o lo echaron: su historial se ve pero no cuenta para la media), `legado` (solo en la "original").
  - `viajes/{id}`: `persona` (pid), `dia` (AAAA-MM-DD), `n` (1, o ±N si es ajuste), `tipo` (`viaje`/`ajuste`), `por` (uid de quien lo apuntó), `creado`.
- `perfiles/{uid}`: `nombre`, y `persona` en los cuatro de siempre.
- `viajes/{id}` (en la raíz): la colección de antes del multiusuario. Ver «Pendiente».

- **Vacapol** (las vacaciones; aparte de Kundapol, con su logo `vacapol.svg` y PNG `vacapol-*.png`, en `vacaciones.html` + `vacaciones.js`, con su `vacaciones.webmanifest`; mismo Firebase, mismo `style.css` y mismo `sw.js`):
  - `turnos/{tid}`: `nombre`, `inicio` (AAAA-MM-DD, primer día de trabajo de una tanda), `admin` (uid del primero), `admins` (lista de uids de los demás admins; opcional), `uids`, `codigo`, `invitacion`.
    - `miembros/{uid}`: `nombre` (el de `perfiles`).
    - `dias/{uid}_{día}`: `uid`, `dia`, `tipo` (`vac`/`ss`/`nav`/`ap`/`otros`; sin `tipo` cuenta como `vac`). Cada uno apunta, cambia de tipo y quita solo los suyos (los admins también quitan).
  - Se trabajan 6 días y se libran 6 desde `inicio`; la app calcula qué días son de trabajo y solo deja marcar esos. Sin máximo de gente por día. Recuento por persona y año. Dos vistas, «Mes» (calendario con mapa de calor y detalle del día) y «Lista» (un día por línea, por tandas); la elegida se recuerda. Los días pasados se ven atenuados como historial y siguen siendo editables.
  - Mismo funcionamiento que las cundas: crea el admin, enlace `#unirse=<tid>.<codigo>`, echar y salirse.
  - **Varios admins:** son el campo `admin` más la lista `admins`. Un admin puede hacer admin a otro de dentro, pero solo se añaden: nadie le quita el permiso a otro (ni lo echa); cada uno puede quitarse el suyo al salirse, siempre que quede otro. Quien se sale siendo el campo `admin` lo pasa a otro admin. No hay «pasar el turno».
  - **Cuadrante del día** (solo admins; botón «cuadrante» en la cabecera del turno; lógica en `cuadrante.js`, sin Firebase ni DOM):
    - Mañana 07:00–15:00, tarde 15:00–23:00, noche 23:00–07:00, cada una en 3 franjas de 2 h 40 min. Qué turno toca cada uno de los 6 días de la tanda (por defecto M, M, T, T, N, N) va en `turnos/{tid}.cuadrante` = `{ patron: [6 letras M/T/N] }`.
    - Los disponibles son los miembros sin ningún día marcado ese día. Los puestos (CRC, OAV, Delfín móvil, Delfín 3 y Delfín 20; los Delfín son opcionales) y los 3 equipos **se heredan del último cuadrante guardado antes** (ventana de 30 días): se quitan los que hoy no están disponibles y los que no estaban en el anterior (volvieron o son nuevos) quedan en la **bolsa** («Sin asignar») hasta que el admin los pone en un puesto o equipo; cada equipo avisa de cuántos le «faltan» respecto al anterior. Sin cuadrante anterior, reparto automático en equipos casi iguales por orden alfabético (11 → 4, 4, 3). Los de la bolsa no salen en los documentos.
    - Se guarda el día entero al cambiar algo o al descargar (de ahí parte el día siguiente); solo mirar un día no guarda nada. Quien no viene ese día no se guarda, así que, si vuelve, entra por la bolsa.
    - Las tareas de cada equipo son **fijas**: el Equipo 1 empieza siempre en Entrada, el 2 en Salida y el 3 en Pasajeros (cada equipo hace las tres, en ese orden, en las 3 franjas). Lo que rota es **la gente**: al heredar del cuadrante anterior, cada persona pasa al equipo siguiente (1 → 2 → 3 → 1), tantos pasos como días de trabajo hayan pasado (`indiceTrabajo`). Los equipos guardados de un día no se rotan. El campo `rotacion` de `turnos/{tid}.cuadrante` (de la primera versión, cuando se rotaban las tareas) ya no se usa.
    - `turnos/{tid}/cuadrantes/{AAAA-MM-DD}` (solo admins): `crc`, `oav`, `delfin`, `delfin3`, `delfin20` (uid o nulo), `equipos` (mapa uid → 1, 2 o 3) y `ausentes` (lista de uids a los que el admin ha puesto la × ese día: «hoy no viene», aunque no tengan el día marcado; no entran en equipos ni en la bolsa). `movidos` es de la primera versión (sin `equipos`): se sigue leyendo y se pierde al volver a guardar ese día.
    - **Publicar:** el botón «Publicar» de la pantalla del cuadrante guarda una copia con nombres en `turnos/{tid}/publicados/{AAAA-MM-DD}` (`turno` M/T/N, `puestos` {clave: {id, nombre} o nulo}, `equipos` = 3 objetos `{ gente: [{id, nombre}] }` —Firestore no admite listas de listas—, `publicado`, `por`). La leen **todos los del turno** y la escriben los admins. En el detalle del día de la vista Mes del calendario se ve el cuadrante y los equipos publicados (con «Tienes el puesto…» o «Estás en el Equipo N» para cada uno); un día de hoy o futuro sin publicar dice «Aún no hay cuadrante», y uno pasado sin publicar no enseña nada. Si el admin cambia el cuadrante después, la pantalla avisa de «cambios sin publicar» y vuelve a publicar con el botón; «Quitar publicación» lo borra. Publicar también guarda el día. Los admins ven además un enlace «abrir ›» al cuadrante de ese día y la línea de «hoy no viene». No hay nada de esto en la vista Lista.
    - Documentos: «Cuadrante» (tabla con título amarillo y equipos rojo/azul/verde) y «Equipos» (listas). Word con la librería `docx@8.5.0` cargada de jsDelivr solo al pulsar (`DOCX_URL`); PDF por la impresión del navegador (`#hoja-imp` + `@media print`). Para probar los Word, convertirlos con `soffice --headless --convert-to pdf`.
  - Los tipos de día se eligen en una paleta (VAC, SS, NAV, AP, OTR y Borrar); sin nada elegido, tocar un día solo lo selecciona. El recuento lo ve cada uno solo de sí mismo; los admins ven el de todos.

## Herramienta de datos (GitHub Actions)

- Desde aquí **no hay acceso a Firebase**, así que para leer o apuntar datos de producción hay `.github/workflows/bd-admin.yml` + `scripts/bd/bd.mjs`: se lanza **solo a mano** (workflow_dispatch, solo desde `main`) y usa el secreto `FIREBASE_SERVICE_ACCOUNT` (JSON de una cuenta de servicio con rol «Usuario de Cloud Datastore»). Se lanza y se leen los registros con las herramientas de GitHub (`actions_run_trigger`, `get_job_logs`).
- El repositorio es público y sus registros también, así que **nada con datos de personas sale en claro**: `bd.mjs` cifra con `scripts/bd/clave-publica.pem` (RSA-OAEP + AES-256-GCM) entre las marcas `#### INICIO X` / `#### FIN X`. La clave privada solo está en el scratchpad de la sesión que la generó; sin ella no se puede leer (se genera otra pareja y se cambia el `.pem`).
- `exportar` (solo lectura) saca turnos, miembros y días. `aplicar` (con `confirmar=SI` y un plan `[{tid, uid, dia, tipo}]`) comprueba todo antes, saca una copia cifrada de los días, y solo **crea** los que no existían (`create()`, nunca pisa ni borra).
- Pedir siempre confirmación al usuario antes de `aplicar`. Al terminar, que el usuario borre el secreto en GitHub y la clave en Google Cloud.

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
