import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, deleteDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  query, where, orderBy, documentId, arrayUnion, arrayRemove, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { VERSION } from "./version.js";
import {
  TURNOS, TAREA_TEXTO, COLOR_EQUIPO, PATRON_POR_DEFECTO, PUESTOS, patronValido, horarioTurno, tareaDe,
  resolverDia, docDeVista, ponerEnPuesto, ponerEnEquipo, mandarALaBolsa,
  htmlCuadrante, htmlEquipos, docxCuadrante, docxEquipos, nombreArchivo,
} from "./cuadrante.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTC7Im2qfaZodfhH1Qr_Uey4CGEyVw0Yc",
  authDomain: "cundapol.firebaseapp.com",
  projectId: "cundapol",
  storageBucket: "cundapol.firebasestorage.app",
  messagingSenderId: "607823687265",
  appId: "1:607823687265:web:00efe333cd150d229b4420",
};

// Se trabajan 6 días y se libran 6.
// Tipos de día que se pueden pedir. Un día sin tipo (de antes de que existieran) es Vacaciones.
const TIPOS = {
  vac: { nombre: "Vacaciones", siglas: "VAC" },
  ss: { nombre: "Semana Santa", siglas: "SS" },
  nav: { nombre: "Navidad", siglas: "NAV" },
  ap: { nombre: "Asuntos propios", siglas: "AP" },
  otros: { nombre: "Otros", siglas: "OTR" },
};
const tipoDe = (d) => (TIPOS[d.tipo] ? d.tipo : "vac");
const siglas = (t) => `<i class="sg t-${t}" title="${TIPOS[t].nombre}">${TIPOS[t].siglas}</i>`;

const TRABAJO = 6;
const CICLO = 12;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "es"; // los correos de Firebase (recuperar contraseña) salen en español
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const $ = (id) => document.getElementById(id);
const estado = {
  user: null, perfil: { nombre: null },
  turnos: [], turnosListos: false,
  tid: null, turno: null, miembros: [], dias: [], mes: null, sel: null,
  aus: { iso: null, ids: [], dejar: null }, // los marcados «hoy no viene» en el cuadrante del día seleccionado (solo admins)
  pub: { iso: null, doc: null, listo: false, dejar: null }, // el cuadrante publicado del día seleccionado (lo ven todos)
  vista: "mes", herramienta: null, orden: "az", cerosAbiertos: false,
  modoAlta: false, autoAbrir: false, saliendo: false,
};
let dejarDeEscucharTurnos = null;
let dejarDeEscucharTurno = [];

/* ---------- utilidades ---------- */

const pad = (n) => String(n).padStart(2, "0");
const aISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoyISO = () => aISO(new Date());
const aFecha = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtMes = (d) => d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");
const fechaValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && aISO(aFecha(s)) === s;

const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
estado.vista = leer("vacaciones.vista") === "lista" ? "lista" : "mes";
estado.orden = leer("vacaciones.orden") === "mas" ? "mas" : "az";
// La herramienta de la paleta: null (solo mirar), un tipo de día (pintar con él) o "borrar".
// Siempre se abre sin nada elegido para no marcar sin querer.

function nuevoCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_");
}

const PANTALLAS = ["cargando", "entrada", "nombre", "turnos", "cuenta", "cuadrante"];
function mostrar(pantalla) {
  for (const id of PANTALLAS) $(id).hidden = id !== pantalla;
}
const enPantalla = (id) => !$(id).hidden;

let temporizadorAviso;
function aviso(texto) {
  $("aviso-texto").textContent = texto;
  $("aviso-deshacer").hidden = true;
  $("aviso").hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => ($("aviso").hidden = true), 3500);
}

function errorDatos(e) {
  console.error(e);
  aviso(e?.code === "permission-denied"
    ? "Sin permiso. Si no es cosa del admin, cierra la app del todo y ábrela otra vez para actualizarla."
    : "No se ha podido guardar.");
}

/* ---------- el turno de trabajo ---------- */

// Días desde el arranque del turno (negativo si es anterior).
const DIA_MS = 864e5;
function numDia(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const [y0, m0, d0] = estado.turno.inicio.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y0, m0 - 1, d0)) / DIA_MS);
}
const trabaja = (iso) => (((numDia(iso) % CICLO) + CICLO) % CICLO) < TRABAJO;
const tandaDe = (iso) => Math.floor(numDia(iso) / CICLO);

/* ---------- entrada ---------- */

const MENSAJES = {
  "auth/invalid-credential": "Usuario, correo o contraseña no válidos.",
  "auth/wrong-password": "Usuario, correo o contraseña no válidos.",
  "auth/user-not-found": "Usuario, correo o contraseña no válidos.",
  "auth/invalid-email": "Ese correo o usuario no parece válido.",
  "auth/email-already-in-use": "Ese usuario o correo ya tiene cuenta. Prueba a entrar, o elige otro usuario.",
  "auth/weak-password": "La contraseña necesita al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera un rato.",
  "auth/network-request-failed": "Sin conexión.",
  "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase.",
};

// Quien no quiere dar su correo entra con un usuario (sin @). Por dentro es un correo inventado que
// no existe, así que con usuario no se puede recuperar la contraseña.
const DOMINIO_USUARIO = "usuario.invalid";
function aCorreo(texto) {
  const t = texto.trim();
  if (t.includes("@")) return t;
  const usuario = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, ".");
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return null;
  return `${usuario}@${DOMINIO_USUARIO}`;
}

function mostrarError(texto) {
  $("info-entrada").hidden = true;
  const p = $("error-entrada");
  p.textContent = texto;
  p.hidden = false;
}
function errorEntrada(e) {
  if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return;
  mostrarError(MENSAJES[e?.code] ?? "No se ha podido entrar.");
}
const limpiarMensajes = () => { $("error-entrada").hidden = true; $("info-entrada").hidden = true; };

$("btn-google").onclick = async () => {
  limpiarMensajes();
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { errorEntrada(e); }
};

$("form-correo").onsubmit = async (ev) => {
  ev.preventDefault();
  limpiarMensajes();
  const correo = aCorreo($("correo").value);
  if (!correo) return mostrarError("El usuario puede llevar letras, números, punto, guion y guion bajo (de 3 a 30), sin espacios.");
  const clave = $("clave").value;
  try {
    if (estado.modoAlta) await createUserWithEmailAndPassword(auth, correo, clave);
    else await signInWithEmailAndPassword(auth, correo, clave);
  } catch (e) { errorEntrada(e); }
};

$("btn-modo").onclick = () => {
  estado.modoAlta = !estado.modoAlta;
  $("btn-correo").textContent = estado.modoAlta ? "Crear cuenta" : "Entrar";
  $("btn-modo").textContent = estado.modoAlta ? "Ya tengo cuenta, entrar" : "No tengo cuenta, crear una";
  $("btn-olvido").hidden = estado.modoAlta;
  $("clave").autocomplete = estado.modoAlta ? "new-password" : "current-password";
  limpiarMensajes();
};

$("btn-olvido").onclick = async () => {
  limpiarMensajes();
  const texto = $("correo").value.trim();
  if (!texto) return mostrarError("Escribe arriba tu correo y vuelve a pulsar.");
  if (!texto.includes("@")) return mostrarError("Con un usuario no se puede recuperar la contraseña, porque no hay un correo al que mandarla. Crea otra cuenta con otro usuario.");
  const aviso = () => {
    $("info-entrada").textContent = "Si ese correo tiene cuenta, te llegará un enlace para elegir otra contraseña. Mira también en spam.";
    $("info-entrada").hidden = false;
  };
  try {
    await sendPasswordResetEmail(auth, texto);
    aviso();
  } catch (e) {
    // Sin cuenta se contesta lo mismo, para no decir qué correos están registrados.
    if (e?.code === "auth/user-not-found") aviso(); else errorEntrada(e);
  }
};

$("btn-salir").onclick = $("btn-salir-2").onclick = () => {
  for (const k of ["vacaciones.turno", "cundapol.nombre"]) guardar(k, null);
  signOut(auth);
};

/* ---------- invitaciones ---------- */

// El enlace es ...#unirse=<turno>.<código>. Se guarda por si hay que entrar antes.
function leerInvitacion() {
  const m = location.hash.match(/^#unirse=([\w-]+)\.([\w-]+)$/);
  if (m) {
    guardar("vacaciones.invitacion", `${m[1]}.${m[2]}`);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const g = leer("vacaciones.invitacion");
  if (!g) return null;
  const [tid, codigo] = g.split(".");
  return { tid, codigo };
}
const enlaceDe = (t) => `${location.origin}${location.pathname}#unirse=${t.id}.${t.codigo}`;

async function unirse({ tid, codigo }) {
  guardar("vacaciones.invitacion", null);
  try {
    await updateDoc(doc(db, "turnos", tid), { uids: arrayUnion(estado.user.uid), invitacion: codigo });
  } catch (e) {
    // Puede que ya estuviera dentro y el enlace sea viejo: entonces se abre sin más.
    const dentro = await getDoc(doc(db, "turnos", tid)).then((s) => s.exists(), () => false);
    if (!dentro) {
      console.error(e);
      mostrar("turnos");
      pintarTurnos();
      aviso("Ese enlace ya no vale. Pide uno nuevo.");
      return;
    }
  }
  abrirTurno(tid);
}

/* ---------- perfil ---------- */

// El nombre es el mismo que en Cundapol (colección "perfiles").
async function cargarNombre(user) {
  try {
    const snap = await getDoc(doc(db, "perfiles", user.uid));
    const nombre = snap.exists() ? snap.data().nombre ?? null : null;
    if (nombre) guardar("cundapol.nombre", nombre);
    return nombre;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function pedirNombre() {
  $("mi-nombre").value = estado.perfil.nombre ?? estado.user.displayName?.split(" ")[0] ?? "";
  mostrar("nombre");
  $("mi-nombre").focus();
}

$("form-nombre").onsubmit = async (ev) => {
  ev.preventDefault();
  const nombre = $("mi-nombre").value.trim().slice(0, 40);
  if (!nombre) return;
  estado.perfil.nombre = nombre;
  guardar("cundapol.nombre", nombre);
  continuar();
  try {
    await setDoc(doc(db, "perfiles", estado.user.uid), { nombre }, { merge: true });
  } catch (e) { errorDatos(e); }
};

$("btn-renombrar").onclick = pedirNombre;

/* ---------- tus turnos ---------- */

function escucharTurnos() {
  dejarDeEscucharTurnos?.();
  estado.turnosListos = false;
  dejarDeEscucharTurnos = onSnapshot(
    query(collection(db, "turnos"), where("uids", "array-contains", estado.user.uid)),
    { includeMetadataChanges: true },
    (snap) => {
      estado.turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(porNombre);
      estado.turnosListos ||= !snap.metadata.fromCache;
      pintarTurnos();
    },
    (e) => console.error(e),
  );
}

function pintarTurnos() {
  // Recién llegado y con un solo turno: se abre solo.
  if (estado.autoAbrir && estado.turnosListos && estado.turnos.length === 1 && enPantalla("turnos")) {
    estado.autoAbrir = false;
    return abrirTurno(estado.turnos[0].id);
  }
  $("soy-turnos").textContent = estado.perfil.nombre ?? "";
  $("sin-turnos").hidden = !estado.turnosListos || estado.turnos.length > 0;
  $("lista-turnos").innerHTML = estado.turnos
    .map((t) => `<li><button type="button" data-id="${esc(t.id)}">${esc(t.nombre)}${
      adminsDe(t).has(estado.user?.uid) ? `<span class="admin">admin</span>` : ""}</button></li>`)
    .join("");
}

$("lista-turnos").onclick = (ev) => {
  const id = ev.target.closest("button")?.dataset.id;
  if (id) abrirTurno(id);
};

$("btn-cambiar").onclick = () => {
  estado.autoAbrir = false;
  mostrar("turnos");
  pintarTurnos();
};

$("crear-inicio").value = hoyISO();

$("form-crear").onsubmit = async (ev) => {
  ev.preventDefault();
  const nombre = $("crear-nombre").value.trim().slice(0, 40);
  const inicio = $("crear-inicio").value;
  if (!nombre || !fechaValida(inicio)) return;
  estado.autoAbrir = false;
  const uid = estado.user.uid;
  const ref = doc(collection(db, "turnos"));
  try {
    await setDoc(ref, { nombre, inicio, admin: uid, uids: [uid], codigo: nuevoCodigo(), creado: serverTimestamp() });
    await setDoc(doc(ref, "miembros", uid), { nombre: estado.perfil.nombre, uid });
  } catch (e) { errorDatos(e); return; }
  $("crear-nombre").value = "";
  abrirTurno(ref.id);
  abrirInvitar();
};

/* ---------- un turno ---------- */

// Los admins son el campo "admin" (el primero) más la lista "admins". Solo se añaden; nadie le quita
// el permiso a otro, y cada uno puede quitarse el suyo al salirse.
const adminsDe = (t) => new Set([t?.admin, ...(t?.admins ?? [])].filter(Boolean));
const soyAdmin = () => adminsDe(estado.turno).has(estado.user?.uid);

function dejarTurno() {
  for (const f of dejarDeEscucharTurno) f();
  dejarDeEscucharTurno = [];
  dejarCuadrante();
  seguirAusentes(null);
  seguirPublicado(null);
}

function abrirTurno(tid) {
  dejarTurno();
  const hoy = new Date();
  Object.assign(estado, { tid, turno: null, miembros: [], dias: [], sel: null, mes: new Date(hoy.getFullYear(), hoy.getMonth(), 1) });
  guardar("vacaciones.turno", tid);
  mostrar("cargando");
  const ref = doc(db, "turnos", tid);

  const fuera = (e) => {
    if (estado.tid !== tid || estado.saliendo) return;
    console.error(e);
    dejarTurno();
    guardar("vacaciones.turno", null);
    estado.tid = null;
    mostrar("turnos");
    pintarTurnos();
    aviso("Ya no estás en ese turno.");
  };

  dejarDeEscucharTurno.push(
    onSnapshot(ref, (snap) => {
      if (!snap.exists()) { if (!snap.metadata.fromCache) fuera(new Error("no existe")); return; }
      const primera = !estado.turno;
      estado.turno = { id: snap.id, ...snap.data() };
      if (primera) mostrar("cuenta");
      pintar();
    }, fuera),
    onSnapshot(collection(ref, "miembros"), { includeMetadataChanges: true }, (snap) => {
      estado.miembros = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!snap.metadata.fromCache) asegurarMiembro();
      pintar();
    }, (e) => console.error(e)),
    onSnapshot(collection(ref, "dias"), (snap) => {
      estado.dias = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      pintar();
    }, (e) => console.error(e)),
  );
}

// Tu ficha en el turno: se crea al entrar y se mantiene con tu nombre de ahora.
let asegurando = false;
async function asegurarMiembro() {
  const nombre = estado.perfil.nombre;
  if (asegurando || !nombre || !estado.turno) return;
  const mia = estado.miembros.find((m) => m.id === estado.user.uid);
  if (mia?.nombre === nombre) return;
  asegurando = true;
  const ref = doc(db, "turnos", estado.tid, "miembros", estado.user.uid);
  try {
    if (mia) await updateDoc(ref, { nombre });
    else await setDoc(ref, { nombre, uid: estado.user.uid });
  } catch (e) { console.error(e); } finally { asegurando = false; }
}

/* ---------- el calendario ---------- */

const fmtRango = (iso) => aFecha(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" }).replace(/\./g, "");
const fmtLargo = (iso) => aFecha(iso).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const dia3 = (iso) => aFecha(iso).toLocaleDateString("es-ES", { weekday: "short" }).replace(/\./g, "");

function pintar() {
  if (!estado.turno || !estado.mes) return;
  const uid = estado.user.uid;
  const gente = new Map(estado.miembros.map((m) => [m.id, m.nombre]));
  const dias = estado.dias.filter((d) => gente.has(d.uid));

  $("turno-nombre").textContent = estado.turno.nombre;
  $("btn-cuadrante").hidden = $("sep-cuadrante").hidden = !soyAdmin();
  $("soy").textContent = estado.perfil.nombre ?? "";
  $("mes-titulo").textContent = fmtMes(estado.mes);
  for (const b of document.querySelectorAll("[data-vista]")) b.setAttribute("aria-pressed", String(b.dataset.vista === estado.vista));
  $("vista-mes").hidden = estado.vista !== "mes";
  $("vista-lista").hidden = estado.vista !== "lista";

  const h = estado.herramienta;
  for (const b of document.querySelectorAll("[data-herr]")) b.setAttribute("aria-pressed", String(b.dataset.herr === h));
  const banda = $("banda");
  banda.className = `banda${h ? "" : " neutra"}`;
  banda.style.setProperty("--c", h === "borrar" ? "#a3261a" : h ? `var(--c-${h})` : "");
  banda.innerHTML = h === "borrar"
    ? `<b>Borrando</b><span>Toca tus días para quitarlos. Toca «Borrar» otra vez para soltar.</span>`
    : h
      ? `<b>Pintando ${esc(TIPOS[h].nombre)}</b><span>Toca los días para marcarlos; si ya lo son, se quitan. Toca ${TIPOS[h].siglas} otra vez para soltar.</span>`
      : `<span>Toca un día para ver quién lo ha pedido, o elige un tipo para pintar.</span>`;

  const pedidos = new Map(); // día → [{ u, tipo }]
  for (const d of dias) {
    if (!pedidos.has(d.dia)) pedidos.set(d.dia, []);
    pedidos.get(d.dia).push({ u: d.uid, tipo: tipoDe(d) });
  }
  const quienes = (iso) => (pedidos.get(iso) ?? []).map((x) => ({ ...x, nombre: gente.get(x.u) })).sort(porNombre);

  const y = estado.mes.getFullYear();
  const m = estado.mes.getMonth();
  const ultimo = new Date(y, m + 1, 0).getDate();
  const hoy = hoyISO();
  const iso = (n) => `${y}-${pad(m + 1)}-${pad(n)}`;
  const laborables = [];
  for (let n = 1; n <= ultimo; n++) if (trabaja(iso(n))) laborables.push(iso(n));

  if (!laborables.includes(estado.sel)) estado.sel = laborables.includes(hoy) ? hoy : null;

  // Los admins ven en el detalle del día a los que el cuadrante da por «hoy no viene».
  seguirAusentes(soyAdmin() && estado.vista === "mes" ? estado.sel : null);
  const ausentes = estado.aus.iso && estado.aus.iso === estado.sel
    ? estado.aus.ids.filter((u) => gente.has(u)).map((u) => gente.get(u)).sort((a, b) => a.localeCompare(b, "es")) : [];
  // Lo que el admin ha publicado del día seleccionado lo ven todos.
  seguirPublicado(estado.vista === "mes" ? estado.sel : null);
  const cuadrante = estado.vista === "mes" ? bloqueCuadrante(estado.pub, estado.sel, hoy, uid, soyAdmin()) : "";
  if (estado.vista === "mes") pintarMes({ y, m, ultimo, hoy, iso, laborables, quienes, pedidos, uid, ausentes, cuadrante });
  else pintarLista({ laborables, hoy, quienes, pedidos, uid });

  $("rec-anio").textContent = y;
  const cuentas = new Map([...gente.keys()].map((u) => [u, { n: 0, tipos: {} }]));
  for (const d of dias) {
    if (!d.dia.startsWith(`${y}-`)) continue;
    const c = cuentas.get(d.uid);
    c.n++;
    c.tipos[tipoDe(d)] = (c.tipos[tipoDe(d)] ?? 0) + 1;
  }
  pintarRecuento(cuentas, gente, uid);

  if ($("dlg-gente").open) pintarGente();
  if (enPantalla("cuadrante")) pintarCuadrante();
}

// Recuento del año. Cada uno ve el suyo; el admin ve el de todos, con los que no han pedido nada
// plegados al final y la opción de ordenar por nombre o por días.
function pintarRecuento(cuentas, gente, uid) {
  const admin = soyAdmin();
  $("rec-gente").textContent = `${gente.size} ${gente.size === 1 ? "persona" : "personas"} en el turno`;
  $("rec-orden").hidden = !admin;
  for (const b of document.querySelectorAll("[data-orden]")) b.setAttribute("aria-pressed", String(b.dataset.orden === estado.orden));

  const filas = [...cuentas]
    .filter(([u]) => admin || u === uid)
    .map(([u, c]) => ({ u, nombre: gente.get(u), ...c }))
    .sort(estado.orden === "mas" ? (a, b) => b.n - a.n || porNombre(a, b) : porNombre);
  const fila = (p) => {
    const tipos = Object.keys(TIPOS).filter((t) => p.tipos[t]).map((t) => `<span>${siglas(t)}${p.tipos[t]}</span>`).join("");
    return `<li class="${p.n ? "" : "cero"}"><span class="nom">${esc(p.nombre)}${p.u === uid ? `<span class="dif">tú</span>` : ""}</span>${tipos ? `<span class="tipos-rec">${tipos}</span>` : ""}<span class="num">${p.n}</span></li>`;
  };
  // Un no admin solo tiene su fila: se enseña siempre, aunque sea 0.
  const con = admin ? filas.filter((p) => p.n) : filas;
  const sin = admin ? filas.filter((p) => !p.n) : [];
  $("recuento").innerHTML = con.map(fila).join("")
    + (sin.length
      ? `<li class="plegable"><button type="button" class="rec-ceros" id="btn-ceros" aria-expanded="${estado.cerosAbiertos}">${estado.cerosAbiertos ? "▾" : "▸"} Sin días pedidos (${sin.length})</button></li>${estado.cerosAbiertos ? sin.map(fila).join("") : ""}`
      : "");
}

// Calendario del mes: cada día de trabajo se oscurece cuanta más gente lo pide.
function pintarMes({ y, m, ultimo, hoy, iso, laborables, quienes, pedidos, uid, ausentes = [], cuadrante = "" }) {
  const primero = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
  let celdas = "";
  for (let i = 0; i < primero; i++) celdas += `<div class="cel vacia"></div>`;
  for (let n = 1; n <= ultimo; n++) {
    const d = iso(n);
    const clases = `${d < hoy ? " pasado" : ""}${d === hoy ? " hoy-cel" : ""}`;
    if (!laborables.includes(d)) { celdas += `<div class="cel${clases}"><span class="d">${n}</span></div>`; continue; }
    const cuantos = quienes(d).length;
    const mio = pedidos.get(d)?.find((x) => x.u === uid);
    const otros = cuantos - (mio ? 1 : 0);
    // Un día tuyo se pinta con el color de su tipo; el número pequeño son los demás que también lo piden.
    celdas += `<button class="cel trab${clases}${mio ? ` mio t-${mio.tipo}` : ""}${estado.sel === d ? " sel" : ""}" type="button" data-sel="${d}"
      aria-label="${esc(fmtLargo(d))}, ${cuantos} ${cuantos === 1 ? "persona" : "personas"}"><span class="d">${n}</span>${
      mio ? `<span class="sg2">${TIPOS[mio.tipo].siglas}</span>${otros ? `<span class="ot">+${otros}</span>` : ""}` : `<span class="n">${cuantos || ""}</span>`}</button>`;
  }
  $("rejilla").innerHTML = celdas;

  const d = estado.sel;
  if (!d) { $("detalle").innerHTML = `<p class="nota">Toca un día para ver quién lo ha pedido.</p>`; return; }
  const q = quienes(d);
  $("detalle").innerHTML = `<h4>${esc(fmtLargo(d))}<small>${q.length} ${q.length === 1 ? "persona" : "personas"}</small></h4>
    <div class="chips">${q.map((x) => `<span class="chip${x.u === uid ? " yo" : ""}">${esc(x.nombre)} ${siglas(x.tipo)}</span>`).join("") || `<span class="nota">Nadie todavía.</span>`}</div>${cuadrante}${
    ausentes.length ? `<p class="nota det-ausentes">Marcados como «hoy no viene» en el cuadrante (${ausentes.length}):</p>
    <div class="chips">${ausentes.map((n) => `<span class="chip fuera">× ${esc(n)}</span>`).join("")}</div>` : ""}`;
}

// Escucha el cuadrante publicado de un día (lo pueden leer todos los del turno).
function seguirPublicado(iso) {
  if (estado.pub.iso === iso) return;
  estado.pub.dejar?.();
  Object.assign(estado.pub, { iso, doc: null, listo: false, dejar: null });
  if (!iso || !estado.tid) return;
  estado.pub.dejar = onSnapshot(doc(db, "turnos", estado.tid, "publicados", iso), (snap) => {
    if (estado.pub.iso !== iso) return;
    estado.pub.doc = snap.exists() ? snap.data() : null;
    estado.pub.listo = true;
    pintar();
  }, () => { if (estado.pub.iso === iso) { estado.pub.listo = true; pintar(); } });
}

// El cuadrante y los equipos publicados de un día, o «Aún no hay cuadrante» si es hoy o futuro y no se ha publicado.
function bloqueCuadrante(pub, iso, hoy, uid, admin) {
  if (!iso || pub.iso !== iso || !pub.listo) return "";
  const abrir = admin ? `<button class="enlace2" type="button" data-abrir-cuad="${iso}">abrir ›</button>` : "";
  const d = pub.doc;
  if (!d) return iso >= hoy ? `<div class="bloque-cuad"><div class="bloque-cab"><b>Cuadrante</b>${abrir}</div><p class="nota">Aún no hay cuadrante.</p></div>` : "";
  const equipos = (d.equipos ?? []).map((e) => e.gente ?? []);
  const puesto = PUESTOS.find(([k]) => d.puestos?.[k]?.id === uid);
  const equipo = equipos.findIndex((g) => g.some((p) => p.id === uid));
  const yo = puesto ? `Tienes el puesto ${puesto[1]}.` : equipo >= 0 ? `Estás en el Equipo ${equipo + 1}: empiezas en ${TAREA_TEXTO[tareaDe(0, equipo, 0)].nombre}.` : "";
  const filas = PUESTOS.filter(([k]) => d.puestos?.[k] || k === "crc" || k === "oav")
    .map(([k, etiqueta]) => `<span>${etiqueta}</span><b${d.puestos?.[k]?.id === uid ? ' class="yo"' : ""}>${d.puestos?.[k] ? esc(d.puestos[k].nombre) : '<i class="vacio">—</i>'}</b>`).join("");
  return `<div class="bloque-cuad"><div class="bloque-cab"><b>Cuadrante</b>${TURNOS[d.turno] ? ` · ${TURNOS[d.turno].nombre} ${horarioTurno(d.turno)}` : ""}${abrir}</div>
    ${yo ? `<p class="mi-puesto">${esc(yo)}</p>` : ""}
    <div class="puestos-det">${filas}</div>
    ${equipos.map((g, e) => `<div class="mini" style="--c:#${COLOR_EQUIPO[e]}"><div class="mini-cab"><b>Equipo ${e + 1}</b><small>empieza en ${TAREA_TEXTO[tareaDe(0, e, 0)].nombre} · ${g.length}</small></div>
      <div class="mini-gente">${g.map((p) => (p.id === uid ? `<b class="yo">${esc(p.nombre)}</b>` : esc(p.nombre))).join(" · ") || "<em>Nadie</em>"}</div></div>`).join("")}</div>`;
}

// Escucha los «hoy no viene» del cuadrante de un día (solo admins pueden leerlos).
function seguirAusentes(iso) {
  if (estado.aus.iso === iso) return;
  estado.aus.dejar?.();
  Object.assign(estado.aus, { iso, ids: [], dejar: null });
  if (!iso || !estado.tid) return;
  estado.aus.dejar = onSnapshot(doc(db, "turnos", estado.tid, "cuadrantes", iso), (snap) => {
    if (estado.aus.iso !== iso) return;
    const ids = snap.exists() ? snap.data().ausentes : null;
    estado.aus.ids = Array.isArray(ids) ? ids : [];
    pintar();
  }, () => {});
}

// Lista del mes: un día por línea, agrupados por tanda de trabajo.
function pintarLista({ laborables, hoy, quienes, pedidos, uid }) {
  const grupos = [];
  for (const d of laborables) {
    const t = tandaDe(d);
    if (grupos.at(-1)?.t !== t) grupos.push({ t, dias: [] });
    grupos.at(-1).dias.push(d);
  }
  $("dias").innerHTML = grupos.map((g) => {
    const activo = estado.herramienta;
    const todos = activo === "borrar" || (!!activo && g.dias.every((d) => pedidos.get(d)?.some((x) => x.u === uid && x.tipo === activo)));
    const filas = g.dias.map((d) => {
      const q = quienes(d);
      const mio = q.find((x) => x.u === uid);
      const nombres = q.map((x) => `${x.u === uid ? `<b>${esc(x.nombre)}</b>` : esc(x.nombre)} ${siglas(x.tipo)}`).join(" ");
      return `<button class="fila-dia${mio ? " mia" : ""}${d === hoy ? " hoy-dia" : ""}${d < hoy ? " pasado" : ""}" type="button" data-dia="${d}" aria-pressed="${!!mio}" aria-label="${esc(fmtLargo(d))}">
        <span class="cu">${esc(dia3(d))}<small>${Number(d.slice(8))}</small></span>
        <span class="qu">${nombres || `<span class="nadie">—</span>`}</span>
        <span class="co">${q.length || ""}</span><span class="ck">${mio ? siglas(mio.tipo) : ""}</span></button>`;
    }).join("");
    return `<div class="grupo"><div class="grupo-cab"><span>${esc(fmtRango(g.dias[0]))} – ${esc(fmtRango(g.dias.at(-1)))}</span>
      ${activo ? `<button class="enlace" type="button" data-tanda="${g.dias.join(",")}" data-quitar="${todos}">${todos ? "Quitar todos" : `Marcar todos ${TIPOS[activo].siglas}`}</button>` : ""}</div>${filas}</div>`;
  }).join("") || `<p class="vacio">Este mes no hay días de trabajo.</p>`;
}

function moverMes(delta) {
  estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + delta, 1);
  pintar();
}
$("mes-ant").onclick = () => moverMes(-1);
$("mes-sig").onclick = () => moverMes(1);

for (const b of document.querySelectorAll("[data-orden]")) {
  b.onclick = () => { estado.orden = b.dataset.orden; guardar("vacaciones.orden", estado.orden); pintar(); };
}
$("recuento").addEventListener("click", (ev) => {
  if (ev.target.closest("#btn-ceros")) { estado.cerosAbiertos = !estado.cerosAbiertos; pintar(); }
});

// Tocar la herramienta elegida la suelta.
for (const b of document.querySelectorAll("[data-herr]")) {
  b.onclick = () => { estado.herramienta = estado.herramienta === b.dataset.herr ? null : b.dataset.herr; pintar(); };
}

for (const b of document.querySelectorAll("[data-vista]")) {
  b.onclick = () => { estado.vista = b.dataset.vista; guardar("vacaciones.vista", estado.vista); pintar(); };
}

const idDia = (uid, dia) => `${uid}_${dia}`;
const refDia = (dia) => doc(db, "turnos", estado.tid, "dias", idDia(estado.user.uid, dia));

$("cuenta").addEventListener("click", async (ev) => {
  const uid = estado.user.uid;
  const h = estado.herramienta;
  const mios = new Map(estado.dias.filter((d) => d.uid === uid).map((d) => [d.dia, tipoDe(d)]));
  const btnSel = ev.target.closest("button[data-sel]");
  const btnDia = ev.target.closest("button[data-dia]");
  const btnTanda = ev.target.closest("button[data-tanda]");
  const btnAbrir = ev.target.closest("button[data-abrir-cuad]");
  if (btnAbrir) { cuad.iso = btnAbrir.dataset.abrirCuad; return abrirCuadrante(); }
  try {
    // Sin herramienta solo se mira. Con un tipo, el día se pinta (o se quita si ya era de ese tipo); con «borrar», se quita.
    if (btnSel || btnDia) {
      const dia = btnSel ? btnSel.dataset.sel : btnDia.dataset.dia;
      if (btnSel) estado.sel = dia;
      if (!h) pintar();
      else if (h === "borrar") { if (mios.has(dia)) await deleteDoc(refDia(dia)); }
      else if (mios.get(dia) === h) await deleteDoc(refDia(dia));
      else await setDoc(refDia(dia), { uid, dia, tipo: h });
    } else if (btnTanda && h) {
      const lote = writeBatch(db);
      const quitar = h === "borrar" || btnTanda.dataset.quitar === "true";
      for (const dia of btnTanda.dataset.tanda.split(",")) {
        if (quitar) { if (mios.has(dia)) lote.delete(refDia(dia)); }
        else if (mios.get(dia) !== h) lote.set(refDia(dia), { uid, dia, tipo: h });
      }
      await lote.commit();
    }
  } catch (e) { errorDatos(e); }
});

/* ---------- gente del turno ---------- */

function abrirGente() {
  pintarGente();
  $("dlg-gente").showModal();
}
$("btn-gente").onclick = abrirGente;

function pintarGente() {
  const admin = soyAdmin();
  const yo = estado.user.uid;
  $("gente-admin").hidden = !admin;
  if (admin && !$("gente-admin").contains(document.activeElement)) {
    $("gente-nombre").value = estado.turno?.nombre ?? "";
    $("gente-inicio").value = estado.turno?.inicio ?? "";
  }
  const admins = adminsDe(estado.turno);
  $("gente-lista").innerHTML = [...estado.miembros].sort(porNombre).map((m) => {
    const etiquetas = [admins.has(m.id) ? "admin" : "", m.id === yo ? "tú" : ""].filter(Boolean).join(" · ");
    // Un admin puede hacer admin a quien no lo es y echarlo; a otro admin no se le toca.
    const botones = admin && !admins.has(m.id)
      ? `<button class="enlace" type="button" data-accion="admin" data-id="${esc(m.id)}">hacer admin</button>
         <button class="enlace" type="button" data-accion="echar" data-id="${esc(m.id)}">echar</button>`
      : "";
    return `<li><span class="nom">${esc(m.nombre)}${etiquetas ? `<span class="dif">${etiquetas}</span>` : ""}</span><span class="acciones-gente">${botones}</span></li>`;
  }).join("");
  const puedeSalir = !admin || [...admins].some((u) => u !== yo && estado.miembros.some((m) => m.id === u));
  $("btn-salir-turno").hidden = !puedeSalir;
  $("gente-nota").textContent = !admin
    ? "Si sales, tus días dejan de contar. Puedes volver con el enlace."
    : puedeSalir
      ? "Puedes salirte mientras quede otro admin. Un admin no puede quitarle el permiso a otro."
      : "Para salirte, nombra antes a otro admin.";
}

$("btn-gente-guardar").onclick = async () => {
  const nombre = $("gente-nombre").value.trim().slice(0, 40);
  const inicio = $("gente-inicio").value;
  if (!nombre || !fechaValida(inicio)) return aviso("Pon un nombre y una fecha.");
  if (nombre === estado.turno.nombre && inicio === estado.turno.inicio) return;
  try { await updateDoc(doc(db, "turnos", estado.tid), { nombre, inicio }); aviso("Guardado"); } catch (e) { errorDatos(e); }
};

$("gente-lista").onclick = async (ev) => {
  const btn = ev.target.closest("button[data-accion]");
  const m = estado.miembros.find((x) => x.id === btn?.dataset.id);
  if (!m) return;
  const ref = doc(db, "turnos", estado.tid);
  try {
    if (btn.dataset.accion === "admin") {
      if (!confirm(`¿Hacer admin a ${m.nombre}? Podrá cambiar el turno, echar gente y ver el recuento de todos, y nadie podrá quitarle el permiso.`)) return;
      await updateDoc(ref, { admins: arrayUnion(m.id) });
      aviso(`${m.nombre} ya es admin`);
    } else {
      if (!confirm(`¿Echar a ${m.nombre}? Deja de salir en el calendario. El enlace de invitación cambia para que no pueda volver con el viejo.`)) return;
      const lote = writeBatch(db);
      lote.delete(doc(ref, "miembros", m.id));
      lote.update(ref, { uids: arrayRemove(m.id), codigo: nuevoCodigo() });
      await lote.commit();
      aviso(`${m.nombre} ya no está en el turno`);
    }
    pintarGente();
  } catch (e) { errorDatos(e); }
};

$("btn-salir-turno").onclick = async () => {
  const nombre = estado.turno?.nombre ?? "este turno";
  if (!confirm(`¿Salir de «${nombre}»? Para volver necesitarás el enlace.`)) return;
  const ref = doc(db, "turnos", estado.tid);
  try {
    const yo = estado.user.uid;
    const lote = writeBatch(db);
    lote.delete(doc(ref, "miembros", yo));
    const cambios = { uids: arrayRemove(yo) };
    if (soyAdmin()) {
      // Un admin se sale quitándose también de la lista; si era el primero, el campo «admin» pasa a otro admin.
      cambios.admins = arrayRemove(yo);
      if (estado.turno.admin === yo) cambios.admin = [...adminsDe(estado.turno)].find((u) => u !== yo);
    }
    lote.update(ref, cambios);
    estado.saliendo = true; // sin reactivar la ficha ni avisar como si te hubieran echado
    await lote.commit();
    $("dlg-gente").close();
    dejarTurno();
    guardar("vacaciones.turno", null);
    estado.tid = null;
    mostrar("turnos");
    pintarTurnos();
    aviso(`Has salido de «${nombre}»`);
  } catch (e) { errorDatos(e); } finally { estado.saliendo = false; }
};

/* ---------- invitar ---------- */

function abrirInvitar() {
  $("invitar-enlace").value = estado.turno?.codigo ? enlaceDe(estado.turno) : "Cargando…";
  $("btn-enlace-nuevo").hidden = !soyAdmin();
  $("dlg-invitar").showModal();
}
$("btn-invitar").onclick = abrirInvitar;

$("btn-compartir").onclick = async () => {
  if (!estado.turno?.codigo) return;
  const url = enlaceDe(estado.turno);
  const texto = `Únete a «${estado.turno.nombre}» para apuntar qué días quieres vacaciones:`;
  try {
    if (navigator.share) await navigator.share({ title: "Vacaciones", text: texto, url });
    else { await navigator.clipboard.writeText(url); aviso("Enlace copiado"); }
  } catch (e) {
    if (e?.name !== "AbortError") { $("invitar-enlace").select(); aviso("Cópialo a mano"); }
  }
};

$("btn-enlace-nuevo").onclick = async () => {
  if (!confirm("El enlace de ahora dejará de valer para quien no haya entrado todavía. ¿Hacer uno nuevo?")) return;
  const codigo = nuevoCodigo();
  try {
    await updateDoc(doc(db, "turnos", estado.tid), { codigo });
    $("invitar-enlace").value = enlaceDe({ id: estado.tid, codigo });
    aviso("Enlace nuevo hecho");
  } catch (e) { errorDatos(e); }
};

/* ---------- cuadrante del día (solo admins) ---------- */

const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js";
const cuad = { iso: hoyISO(), doc: {}, existe: false, docListo: false, base: null, baseIso: null, baseListo: false, pub: null, pubListo: false, dejar: null };

const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return aISO(d); };

// Qué toca ese día según la tanda: turno (M/T/N), posición en la tanda y base de la rotación; null si es de descanso.
function diaDeCuadrante(iso) {
  const n = numDia(iso);
  const pos = ((n % CICLO) + CICLO) % CICLO;
  if (pos >= TRABAJO) return null;
  const ajustes = estado.turno?.cuadrante ?? {};
  const patron = patronValido(ajustes.patron) ? ajustes.patron : PATRON_POR_DEFECTO;
  // Las tareas de cada equipo son fijas (base 0): lo que rota cada día es la gente.
  return { turno: patron[pos], pos, base: 0 };
}

// Nº de día de trabajo contando los 6 de cada tanda seguidos: la diferencia entre dos días dice
// cuántos equipos ha rotado la gente entre uno y otro.
function indiceTrabajo(iso) {
  const n = numDia(iso);
  const t = Math.floor(n / CICLO);
  return t * TRABAJO + Math.min(n - t * CICLO, TRABAJO - 1);
}

function escucharCuadrante() {
  cuad.dejar?.();
  Object.assign(cuad, { doc: {}, existe: false, docListo: false, base: null, baseIso: null, baseListo: false, pub: null, pubListo: false });
  const iso = cuad.iso;
  const dejarDoc = onSnapshot(doc(db, "turnos", estado.tid, "cuadrantes", iso), (snap) => {
    if (cuad.iso !== iso) return;
    cuad.doc = snap.exists() ? snap.data() : {};
    cuad.existe = snap.exists();
    cuad.docListo = true;
    pintarCuadrante();
  }, (e) => console.error(e));
  const dejarPub = onSnapshot(doc(db, "turnos", estado.tid, "publicados", iso), (snap) => {
    if (cuad.iso !== iso) return;
    cuad.pub = snap.exists() ? snap.data() : null;
    cuad.pubListo = true;
    pintarCuadrante();
  }, (e) => console.error(e));
  cuad.dejar = () => { dejarDoc(); dejarPub(); };
  cargarBaseCuadrante(iso);
}
function dejarCuadrante() { cuad.dejar?.(); cuad.dejar = null; }

// El último cuadrante guardado antes de este día: de ahí se heredan los puestos y los equipos.
async function cargarBaseCuadrante(iso) {
  try {
    // Los de los 30 días anteriores (por id, que es la fecha), y vale el último.
    const q = query(collection(db, "turnos", estado.tid, "cuadrantes"), where(documentId(), ">=", sumarDias(iso, -30)), where(documentId(), "<", iso), orderBy(documentId()));
    const snap = await getDocs(q);
    if (cuad.iso !== iso) return;
    const ultimo = snap.docs.at(-1);
    cuad.base = ultimo ? ultimo.data() : null;
    cuad.baseIso = ultimo ? ultimo.id : null;
  } catch (e) {
    console.error(e);
    if (cuad.iso !== iso) return;
  }
  cuad.baseListo = true;
  pintarCuadrante();
}

// Todo lo que depende del día y de quién está: disponibles, vista (puestos, equipos, bolsa) y datos de los documentos.
function calcularCuadrante() {
  const info = diaDeCuadrante(cuad.iso);
  const libres = new Set(estado.dias.filter((d) => d.dia === cuad.iso).map((d) => d.uid));
  // «Hoy no viene»: los que la app daría por presentes pero el admin ha marcado con la ×.
  const ausentes = new Set(Array.isArray(cuad.doc.ausentes) ? cuad.doc.ausentes : []);
  const gente = estado.miembros.map((m) => ({ id: m.id, nombre: m.nombre }));
  const alfa = (a, b) => a.nombre.localeCompare(b.nombre, "es");
  const disponibles = gente.filter((p) => !libres.has(p.id) && !ausentes.has(p.id)).sort(alfa);
  const libran = gente.filter((p) => libres.has(p.id)).sort(alfa);
  const noVienen = gente.filter((p) => !libres.has(p.id) && ausentes.has(p.id)).sort(alfa);
  const pasos = cuad.baseIso ? ((((indiceTrabajo(cuad.iso) - indiceTrabajo(cuad.baseIso)) % 3) + 3) % 3) : 0;
  const vista = info ? resolverDia(disponibles, cuad.doc, cuad.base, pasos) : null;
  const nombreDe = (id) => gente.find((p) => p.id === id)?.nombre ?? null;
  return {
    info, disponibles, libran, noVienen, vista, pasos, nombreDe,
    datos: info && {
      turno: info.turno, iso: cuad.iso, base: info.base, equipos: vista.equipos.map((eq) => eq.map((p) => p.nombre)),
      crc: nombreDe(vista.puestos.crc), oav: nombreDe(vista.puestos.oav), delfin: nombreDe(vista.puestos.delfin), delfin3: nombreDe(vista.puestos.delfin3), delfin20: nombreDe(vista.puestos.delfin20),
    },
  };
}

// Lo que se guarda de un día: la vista (puestos y equipos) y los que hoy no vienen.
const docParaGuardar = (c) => ({ ...docDeVista(c.vista), ausentes: c.noVienen.map((p) => p.id) });

const chipCuad = (p, extra = "") => `<span class="chipx"><button class="chip${extra}" type="button" data-mover="${esc(p.id)}">${esc(p.nombre)}</button><button class="x" type="button" data-ausente="${esc(p.id)}" aria-label="${esc(p.nombre)}: hoy no viene" title="Hoy no viene">×</button></span>`;

function pintarCuadrante() {
  if (!estado.turno || !enPantalla("cuadrante")) return;
  const c = calcularCuadrante();
  $("cuad-fecha").value = cuad.iso;
  const banda = $("cuad-turno");
  const listo = cuad.docListo && cuad.baseListo;
  $("cuad-cuerpo").hidden = !c.info || !listo;
  if (!c.info) {
    banda.innerHTML = `<b>Día de descanso</b><small>Este día no se trabaja, así que no hay cuadrante.</small>`;
  } else if (!listo) {
    banda.innerHTML = `<b>${TURNOS[c.info.turno].nombre}</b> · ${horarioTurno(c.info.turno)}<small>Cargando…</small>`;
  } else {
    const v = c.vista;
    banda.innerHTML = `<b>${TURNOS[c.info.turno].nombre}</b> · ${horarioTurno(c.info.turno)}<small>Trabajan ${c.disponibles.length}${
      c.libran.length ? ` · libran ${c.libran.length} (${c.libran.map((p) => esc(p.nombre)).join(", ")})` : ""}</small>`;
    $("cuad-origen").textContent = v.origen === "guardado" ? "Guardado."
      : v.origen === "anterior" ? `Partimos del cuadrante del ${fmtRango(cuad.baseIso)}: los puestos se repiten${c.pasos ? " y cada persona pasa al equipo siguiente (1 → 2 → 3 → 1)" : ", igual que los equipos"}, sin los que hoy no están. Se guarda al cambiar algo o al descargar.`
      : "Sin cuadrante anterior: reparto automático. Se guarda al cambiar algo o al descargar.";
    for (const [k] of PUESTOS) {
      const otros = new Set(PUESTOS.map(([x]) => x).filter((x) => x !== k).map((x) => v.puestos[x]).filter(Boolean));
      $(`cuad-${k}`).innerHTML = `<option value="">${k === "crc" || k === "oav" ? "Sin elegir" : "Sin nombrar"}</option>` + c.disponibles
        .map((p) => `<option value="${esc(p.id)}"${otros.has(p.id) ? " disabled" : ""}${v.puestos[k] === p.id ? " selected" : ""}>${esc(p.nombre)}</option>`).join("");
    }
    $("cuad-equipos").innerHTML = v.equipos.map((eq, e) => `<div class="eqcard" style="--c:#${COLOR_EQUIPO[e]}">
      <b>Equipo ${e + 1}</b><small>${eq.length} · empieza en ${TAREA_TEXTO[tareaDe(c.info.base, e, 0)].nombre}</small>${v.faltan[e] ? `<span class="falta">falta ${v.faltan[e]}</span>` : ""}
      <div class="chips">${eq.map((p) => chipCuad(p)).join("") || `<span class="nota">Nadie</span>`}</div></div>`).join("");
    $("cuad-bolsa-sec").hidden = !v.bolsa.length;
    $("cuad-bolsa").innerHTML = v.bolsa.map((p) => chipCuad(p, " nuevo")).join("");
    $("cuad-bolsa-n").textContent = v.bolsa.length;
    $("cuad-ausentes-sec").hidden = !c.noVienen.length;
    $("cuad-ausentes").innerHTML = c.noVienen.map((p) => `<span class="chipx ausente"><span class="chip">${esc(p.nombre)}</span><button class="x" type="button" data-vuelve="${esc(p.id)}" aria-label="${esc(p.nombre)}: vuelve" title="Devolver a «Sin asignar»">↩</button></span>`).join("");
    $("cuad-ausentes-n").textContent = c.noVienen.length;
    pintarPublicar(c);
  }
  // Ajustes (solo si no se está editando alguno ahora mismo)
  if (!$("cuad-patron").contains(document.activeElement)) {
    const ajustes = estado.turno.cuadrante ?? {};
    const patron = patronValido(ajustes.patron) ? ajustes.patron : PATRON_POR_DEFECTO;
    $("cuad-patron").innerHTML = patron.map((t, i) => `<label>Día ${i + 1}<select data-patron="${i}">${
      Object.entries(TURNOS).map(([k, v]) => `<option value="${k}"${k === t ? " selected" : ""}>${v.nombre[0] + v.nombre.slice(1).toLowerCase()}</option>`).join("")}</select></label>`).join("");
  }
}

function abrirCuadrante() {
  if (!soyAdmin()) return;
  if (!cuad.iso) cuad.iso = hoyISO();
  mostrar("cuadrante");
  escucharCuadrante();
  pintarCuadrante();
}
function cerrarCuadrante() {
  dejarCuadrante();
  mostrar("cuenta");
  pintar();
}
function irADia(iso) {
  if (!fechaValida(iso)) return;
  cuad.iso = iso;
  escucharCuadrante();
  pintarCuadrante();
}

$("btn-cuadrante").onclick = abrirCuadrante;
$("btn-cuad-volver").onclick = cerrarCuadrante;
$("cuad-ant").onclick = () => irADia(sumarDias(cuad.iso, -1));
$("cuad-sig").onclick = () => irADia(sumarDias(cuad.iso, 1));
$("cuad-fecha").onchange = (ev) => irADia(ev.target.value);

// Se guarda el día entero tal como se ve (sin los que hoy no están), que es de donde parte el día siguiente.
async function guardarDia(d) {
  try {
    await setDoc(doc(db, "turnos", estado.tid, "cuadrantes", cuad.iso), d);
  } catch (e) { errorDatos(e); }
}
function cambiarCuadrante(mutar) {
  const c = calcularCuadrante();
  if (!c.vista) return Promise.resolve();
  return guardarDia(mutar(docParaGuardar(c)));
}

for (const sel of document.querySelectorAll("[data-puesto]")) {
  sel.onchange = () => cambiarCuadrante((d) => ponerEnPuesto(d, sel.dataset.puesto, sel.value || null));
}

// Tocar a alguien (de un equipo o de la bolsa) para asignarlo a un puesto o a un equipo, o mandarlo a la bolsa.
function abrirMover(id) {
  const c = calcularCuadrante();
  const m = estado.miembros.find((x) => x.id === id);
  if (!m || !c.vista) return;
  const v = c.vista;
  const enBolsa = v.bolsa.some((p) => p.id === id);
  const actual = v.equipos.findIndex((eq) => eq.some((p) => p.id === id));
  $("mover-titulo").textContent = enBolsa ? `Asignar a ${m.nombre}` : `Mover a ${m.nombre}`;
  const equipos = [0, 1, 2].map((e) => `<button type="button" class="boton-linea" data-a="e:${e + 1}"${e === actual ? " disabled" : ""}>Equipo ${e + 1} <small>(${v.equipos[e].length}${v.faltan[e] ? `, falta ${v.faltan[e]}` : ""})</small></button>`);
  const puestos = PUESTOS.map(([k, etiqueta]) => {
    const ocupante = v.puestos[k] ? c.nombreDe(v.puestos[k]) : null;
    return `<button type="button" class="boton-linea" data-a="p:${k}">${etiqueta} <small>${ocupante ? `(ahora ${esc(ocupante)})` : "(libre)"}</small></button>`;
  });
  $("mover-botones").innerHTML = equipos.join("") + puestos.join("")
    + (enBolsa ? "" : `<button type="button" class="enlace" data-a="b">Mandar a la bolsa (sin asignar)</button>`);
  $("mover-botones").dataset.id = id;
  $("dlg-mover").showModal();
}
$("cuad-equipos").onclick = $("cuad-bolsa").onclick = (ev) => {
  const ausente = ev.target.closest("button[data-ausente]")?.dataset.ausente;
  if (ausente) {
    const m = estado.miembros.find((x) => x.id === ausente);
    cambiarCuadrante((d) => ({ ...mandarALaBolsa(d, ausente), ausentes: [...new Set([...(d.ausentes ?? []), ausente])] }));
    return aviso(`${m?.nombre ?? "Esa persona"} hoy no viene`);
  }
  const id = ev.target.closest("button[data-mover]")?.dataset.mover;
  if (id) abrirMover(id);
};
$("cuad-ausentes").onclick = (ev) => {
  const id = ev.target.closest("button[data-vuelve]")?.dataset.vuelve;
  if (id) cambiarCuadrante((d) => ({ ...d, ausentes: (d.ausentes ?? []).filter((x) => x !== id) }));
};
$("mover-botones").onclick = async (ev) => {
  const a = ev.target.closest("button[data-a]")?.dataset.a;
  if (!a) return;
  const id = $("mover-botones").dataset.id;
  $("dlg-mover").close();
  await cambiarCuadrante((d) => a === "b" ? mandarALaBolsa(d, id)
    : a.startsWith("p:") ? ponerEnPuesto(d, a.slice(2), id)
    : ponerEnEquipo(d, id, Number(a.slice(2))));
};

$("btn-cuad-guardar").onclick = async () => {
  const patron = [...document.querySelectorAll("[data-patron]")].map((s) => s.value);
  if (!patronValido(patron)) return aviso("Ese patrón no vale.");
  try {
    await updateDoc(doc(db, "turnos", estado.tid), { cuadrante: { patron } });
    aviso("Ajustes guardados");
  } catch (e) { errorDatos(e); }
};

/* ---- publicar ---- */

// Lo que se publica (puestos y equipos) y lo que se ve ahora, para saber si hay cambios sin publicar.
const firmaCuadrante = (puestos, equipos) => JSON.stringify([puestos, equipos.map((g) => [...g].sort())]);
const firmaDeVista = (v) => firmaCuadrante(PUESTOS.map(([k]) => v.puestos[k] ?? null), v.equipos.map((eq) => eq.map((p) => p.id)));
const firmaDePublicado = (d) => firmaCuadrante(PUESTOS.map(([k]) => d.puestos?.[k]?.id ?? null), (d.equipos ?? []).map((e) => (e.gente ?? []).map((p) => p.id)));

function pintarPublicar(c) {
  const pub = cuad.pub;
  const boton = $("btn-cuad-publicar");
  $("btn-cuad-despublicar").hidden = !pub;
  if (!cuad.pubListo) { $("cuad-pub-estado").textContent = "Comprobando…"; boton.disabled = true; return; }
  if (!pub) {
    $("cuad-pub-estado").textContent = "Sin publicar: en el calendario se ve «Aún no hay cuadrante».";
    boton.textContent = "Publicar";
    boton.disabled = false;
    return;
  }
  const cuando = pub.publicado?.toDate?.().toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "") ?? "";
  const igual = firmaDePublicado(pub) === firmaDeVista(c.vista);
  $("cuad-pub-estado").textContent = igual ? `Publicado${cuando ? ` el ${cuando}` : ""}. Todos lo ven en el calendario.`
    : `Publicado${cuando ? ` el ${cuando}` : ""}, pero hay cambios sin publicar.`;
  boton.textContent = igual ? "Publicado ✓" : "Publicar los cambios";
  boton.disabled = igual;
}

$("btn-cuad-publicar").onclick = async () => {
  const c = calcularCuadrante();
  if (!c.vista || !c.info) return;
  const sinAsignar = c.vista.bolsa;
  if (sinAsignar.length && !confirm(`Hay ${sinAsignar.length} sin asignar (${sinAsignar.map((p) => p.nombre).join(", ")}) y no saldrán en lo publicado. ¿Publicar igualmente?`)) return;
  try {
    // Publicar también guarda el día, que es de donde parte el siguiente.
    if (!cuad.existe || c.vista.origen === "antiguo") await setDoc(doc(db, "turnos", estado.tid, "cuadrantes", cuad.iso), docParaGuardar(c));
    await setDoc(doc(db, "turnos", estado.tid, "publicados", cuad.iso), {
      turno: c.info.turno,
      puestos: Object.fromEntries(PUESTOS.map(([k]) => [k, c.vista.puestos[k] ? { id: c.vista.puestos[k], nombre: c.nombreDe(c.vista.puestos[k]) } : null])),
      equipos: c.vista.equipos.map((eq) => ({ gente: eq.map((p) => ({ id: p.id, nombre: p.nombre })) })),
      publicado: serverTimestamp(),
      por: estado.user.uid,
    });
    aviso("Publicado en el calendario");
  } catch (e) { errorDatos(e); }
};

$("btn-cuad-despublicar").onclick = async () => {
  if (!confirm("¿Quitar lo publicado? En el calendario volverá a verse «Aún no hay cuadrante».")) return;
  try {
    await deleteDoc(doc(db, "turnos", estado.tid, "publicados", cuad.iso));
    aviso("Publicación quitada");
  } catch (e) { errorDatos(e); }
};

/* ---- descargas ---- */

function bajar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// La librería para hacer el Word solo se baja cuando hace falta.
let cargandoDocx = null;
function cargarDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  cargandoDocx ??= new Promise((ok, ko) => {
    const s = document.createElement("script");
    s.src = DOCX_URL;
    s.onload = () => (window.docx ? ok(window.docx) : ko(new Error("docx no cargó")));
    s.onerror = () => ko(new Error("sin conexión con la librería de Word"));
    document.head.append(s);
  }).finally(() => { cargandoDocx = null; });
  return cargandoDocx;
}

// PDF: se pone el documento en la página y se abre la impresión del sistema (Guardar como PDF).
function imprimirDocumento(clase, d) {
  const hoja = $("hoja-imp");
  hoja.innerHTML = clase === "cuadrante" ? htmlCuadrante(d) : htmlEquipos(d);
  const tituloAntes = document.title;
  document.title = nombreArchivo(clase === "cuadrante" ? "Cuadrante" : "Equipos", d.turno, d.iso, "pdf").replace(/\.pdf$/, "");
  document.body.classList.add("imprimiendo");
  const fin = () => {
    window.removeEventListener("afterprint", fin);
    document.body.classList.remove("imprimiendo");
    document.title = tituloAntes;
    hoja.innerHTML = "";
  };
  window.addEventListener("afterprint", fin);
  window.print();
}

document.querySelector(".descargas").onclick = async (ev) => {
  const btn = ev.target.closest("button[data-doc]");
  if (!btn) return;
  const c = calcularCuadrante();
  if (!c.datos || !c.vista) return;
  const sinAsignar = c.vista.bolsa;
  if (sinAsignar.length && !confirm(`Hay ${sinAsignar.length} sin asignar (${sinAsignar.map((p) => p.nombre).join(", ")}) y no saldrán en los documentos. ¿Descargar igualmente?`)) return;
  // Lo que se descarga queda guardado, y de ahí parte el día siguiente.
  if (!cuad.existe || c.vista.origen === "antiguo") guardarDia(docParaGuardar(c));
  const clase = btn.dataset.doc;
  if (btn.dataset.fmt === "pdf") return imprimirDocumento(clase, c.datos);
  btn.disabled = true;
  try {
    const D = await cargarDocx();
    const documento = clase === "cuadrante" ? docxCuadrante(D, c.datos) : docxEquipos(D, c.datos);
    bajar(await D.Packer.toBlob(documento), nombreArchivo(clase === "cuadrante" ? "Cuadrante" : "Equipos", c.datos.turno, c.datos.iso, "docx"));
  } catch (e) {
    console.error(e);
    aviso("No se ha podido hacer el Word. Mira la conexión.");
  } finally { btn.disabled = false; }
};

/* ---------- arranque ---------- */

// Después de saber tu nombre: a la invitación, al último turno o a la lista.
function continuar() {
  const inv = leerInvitacion();
  if (inv) return unirse(inv);
  const ultimo = leer("vacaciones.turno");
  if (ultimo) return abrirTurno(ultimo);
  estado.autoAbrir = true;
  mostrar("turnos");
  pintarTurnos();
}

onAuthStateChanged(auth, async (user) => {
  estado.user = user;
  if (!user) {
    dejarDeEscucharTurnos?.();
    dejarDeEscucharTurnos = null;
    dejarTurno();
    Object.assign(estado, { perfil: { nombre: null }, turnos: [], tid: null, turno: null, miembros: [], dias: [] });
    // Al salir, la entrada vuelve a «Entrar» y sin la contraseña de antes.
    if (estado.modoAlta) $("btn-modo").click();
    $("clave").value = "";
    mostrar("entrada");
    return;
  }
  escucharTurnos();
  // Si este dispositivo ya sabe tu nombre, se entra sin esperar a la red.
  const local = leer("cundapol.nombre");
  if (local) {
    estado.perfil.nombre = local;
    continuar();
    cargarNombre(user).then((nombre) => {
      if (estado.user !== user || !nombre) return;
      estado.perfil.nombre = nombre;
      pintarTurnos();
      asegurarMiembro();
    });
    return;
  }
  estado.perfil.nombre = await cargarNombre(user);
  if (estado.user !== user) return;
  if (estado.perfil.nombre) continuar();
  else pedirNombre();
});

// Un enlace de invitación abierto con la app ya en marcha.
window.addEventListener("hashchange", () => {
  if (estado.user && estado.perfil.nombre && location.hash.startsWith("#unirse=")) continuar();
});

/* ---------- versión ---------- */

for (const el of document.querySelectorAll(".version")) el.textContent = `Versión ${VERSION}`;

async function buscarVersionNueva() {
  try {
    const texto = await (await fetch(`version.js?v=${Date.now()}`, { cache: "no-store" })).text();
    const publicada = Number(texto.match(/VERSION\s*=\s*(\d+)/)?.[1]);
    if (publicada > VERSION) {
      $("nueva-version-texto").textContent = `Hay una versión nueva (${publicada}).`;
      $("nueva-version").hidden = false;
    }
  } catch {} // sin red no se sabe; ya se mirará
}
$("btn-actualizar").onclick = () => location.reload();

buscarVersionNueva();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") buscarVersionNueva();
});
setInterval(() => document.visibilityState === "visible" && buscarVersionNueva(), 30 * 60 * 1000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.error(e));
}
