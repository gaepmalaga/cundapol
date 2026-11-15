import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, deleteDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  query, where, arrayUnion, arrayRemove, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { VERSION } from "./version.js";
import {
  TURNOS, TAREA_TEXTO, COLOR_EQUIPO, PATRON_POR_DEFECTO, patronValido, horarioTurno, tareaDe, repartir,
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

  if (estado.vista === "mes") pintarMes({ y, m, ultimo, hoy, iso, laborables, quienes, pedidos, uid });
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
function pintarMes({ y, m, ultimo, hoy, iso, laborables, quienes, pedidos, uid }) {
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
    <div class="chips">${q.map((x) => `<span class="chip${x.u === uid ? " yo" : ""}">${esc(x.nombre)} ${siglas(x.tipo)}</span>`).join("") || `<span class="nota">Nadie todavía.</span>`}</div>`;
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
const cuad = { iso: hoyISO(), doc: {}, dejar: null, listo: false };

const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return aISO(d); };

// Qué toca ese día según la tanda: turno (M/T/N), posición en la tanda y base de la rotación; null si es de descanso.
function diaDeCuadrante(iso) {
  const n = numDia(iso);
  const pos = ((n % CICLO) + CICLO) % CICLO;
  if (pos >= TRABAJO) return null;
  const ajustes = estado.turno?.cuadrante ?? {};
  const patron = patronValido(ajustes.patron) ? ajustes.patron : PATRON_POR_DEFECTO;
  const rotacion = [0, 1, 2].includes(ajustes.rotacion) ? ajustes.rotacion : 0;
  return { turno: patron[pos], pos, base: rotacion + pos };
}

function escucharCuadrante() {
  cuad.dejar?.();
  cuad.listo = false;
  cuad.doc = {};
  const iso = cuad.iso;
  cuad.dejar = onSnapshot(doc(db, "turnos", estado.tid, "cuadrantes", iso), (snap) => {
    if (cuad.iso !== iso) return;
    cuad.doc = snap.exists() ? snap.data() : {};
    cuad.listo = true;
    pintarCuadrante();
  }, (e) => console.error(e));
}
function dejarCuadrante() { cuad.dejar?.(); cuad.dejar = null; }

// Todo lo que depende del día y de quién está: disponibles, puestos, equipos y los datos de los documentos.
function calcularCuadrante() {
  const info = diaDeCuadrante(cuad.iso);
  const libres = new Set(estado.dias.filter((d) => d.dia === cuad.iso).map((d) => d.uid));
  const gente = estado.miembros.map((m) => ({ id: m.id, nombre: m.nombre }));
  const disponibles = gente.filter((p) => !libres.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const libran = gente.filter((p) => libres.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const dispIds = new Set(disponibles.map((p) => p.id));
  // Un puesto de alguien que ya no está disponible (por ejemplo, ha marcado ese día después) cuenta como vacío.
  const puestos = {};
  for (const k of ["crc", "oav", "delfin"]) puestos[k] = dispIds.has(cuad.doc[k]) ? cuad.doc[k] : null;
  const movidos = cuad.doc.movidos ?? {};
  const equipos = info ? repartir(disponibles, puestos, movidos) : [[], [], []];
  const nombreDe = (id) => gente.find((p) => p.id === id)?.nombre ?? null;
  return {
    info, disponibles, libran, puestos, movidos, equipos,
    datos: info && {
      turno: info.turno, iso: cuad.iso, base: info.base, equipos: equipos.map((eq) => eq.map((p) => p.nombre)),
      crc: nombreDe(puestos.crc), oav: nombreDe(puestos.oav), delfin: nombreDe(puestos.delfin),
    },
  };
}

function pintarCuadrante() {
  if (!estado.turno || !enPantalla("cuadrante")) return;
  const c = calcularCuadrante();
  $("cuad-fecha").value = cuad.iso;
  const banda = $("cuad-turno");
  $("cuad-cuerpo").hidden = !c.info;
  if (!c.info) {
    banda.innerHTML = `<b>Día de descanso</b><small>Este día no se trabaja, así que no hay cuadrante.</small>`;
  } else {
    banda.innerHTML = `<b>${TURNOS[c.info.turno].nombre}</b> · ${horarioTurno(c.info.turno)}<small>Trabajan ${c.disponibles.length}${
      c.libran.length ? ` · libran ${c.libran.length} (${c.libran.map((p) => esc(p.nombre)).join(", ")})` : ""}</small>`;
    for (const k of ["crc", "oav", "delfin"]) {
      const otros = new Set(["crc", "oav", "delfin"].filter((x) => x !== k).map((x) => c.puestos[x]).filter(Boolean));
      $(`cuad-${k}`).innerHTML = `<option value="">${k === "delfin" ? "Sin nombrar" : "Sin elegir"}</option>` + c.disponibles
        .map((p) => `<option value="${esc(p.id)}"${otros.has(p.id) ? " disabled" : ""}${c.puestos[k] === p.id ? " selected" : ""}>${esc(p.nombre)}</option>`).join("");
    }
    $("cuad-equipos").innerHTML = c.equipos.map((eq, e) => `<div class="eqcard" style="--c:#${COLOR_EQUIPO[e]}">
      <b>Equipo ${e + 1}</b><small>Empieza en ${TAREA_TEXTO[tareaDe(c.info.base, e, 0)].nombre}</small>
      <div class="chips">${eq.map((p) => `<button class="chip${c.movidos[p.id] ? " movido" : ""}" type="button" data-mover="${esc(p.id)}">${esc(p.nombre)}</button>`).join("") || `<span class="nota">Nadie</span>`}</div></div>`).join("");
  }
  // Ajustes (solo si no se está editando alguno ahora mismo)
  if (!$("cuad-patron").contains(document.activeElement)) {
    const ajustes = estado.turno.cuadrante ?? {};
    const patron = patronValido(ajustes.patron) ? ajustes.patron : PATRON_POR_DEFECTO;
    $("cuad-patron").innerHTML = patron.map((t, i) => `<label>Día ${i + 1}<select data-patron="${i}">${
      Object.entries(TURNOS).map(([k, v]) => `<option value="${k}"${k === t ? " selected" : ""}>${v.nombre[0] + v.nombre.slice(1).toLowerCase()}</option>`).join("")}</select></label>`).join("");
    $("cuad-rotacion").value = String([0, 1, 2].includes(ajustes.rotacion) ? ajustes.rotacion : 0);
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

// Guarda solo los campos que se dan (el resto del día se queda como está).
async function guardarCuadrante(parcial) {
  try {
    await setDoc(doc(db, "turnos", estado.tid, "cuadrantes", cuad.iso), parcial, { mergeFields: Object.keys(parcial) });
  } catch (e) { errorDatos(e); }
}

for (const sel of document.querySelectorAll("[data-puesto]")) {
  sel.onchange = () => guardarCuadrante({ [sel.dataset.puesto]: sel.value || null });
}

$("btn-cuad-repetir").onclick = async () => {
  const c = calcularCuadrante();
  if (!c.info) return;
  try {
    for (let k = 1; k <= 14; k++) {
      const iso = sumarDias(cuad.iso, -k);
      const snap = await getDoc(doc(db, "turnos", estado.tid, "cuadrantes", iso));
      const d = snap.exists() ? snap.data() : null;
      if (!d || !(d.crc || d.oav || d.delfin)) continue;
      const dispIds = new Set(c.disponibles.map((p) => p.id));
      const usados = new Set();
      const nuevo = {};
      for (const p of ["crc", "oav", "delfin"]) {
        const id = d[p];
        nuevo[p] = id && dispIds.has(id) && !usados.has(id) ? id : null;
        if (nuevo[p]) usados.add(id);
      }
      await guardarCuadrante(nuevo);
      return aviso(`Puestos de ${fmtRango(iso)}`);
    }
    aviso("No hay puestos de los últimos días");
  } catch (e) { errorDatos(e); }
};

// Mover a alguien de equipo a mano.
$("cuad-equipos").onclick = (ev) => {
  const id = ev.target.closest("button[data-mover]")?.dataset.mover;
  const m = estado.miembros.find((x) => x.id === id);
  if (!m) return;
  const c = calcularCuadrante();
  const actual = c.equipos.findIndex((eq) => eq.some((p) => p.id === id));
  $("mover-titulo").textContent = `Mover a ${m.nombre}`;
  $("mover-botones").innerHTML = [0, 1, 2].map((e) => `<button type="button" class="boton-linea" data-a="${e + 1}"${e === actual ? " disabled" : ""}>Equipo ${e + 1}</button>`).join("")
    + (c.movidos[id] ? `<button type="button" class="enlace" data-a="0">Quitar el cambio</button>` : "");
  $("mover-botones").dataset.id = id;
  $("dlg-mover").showModal();
};
$("mover-botones").onclick = async (ev) => {
  const a = ev.target.closest("button[data-a]")?.dataset.a;
  if (a == null) return;
  const id = $("mover-botones").dataset.id;
  const movidos = { ...(cuad.doc.movidos ?? {}) };
  if (a === "0") delete movidos[id]; else movidos[id] = Number(a);
  $("dlg-mover").close();
  await guardarCuadrante({ movidos });
};

$("btn-cuad-guardar").onclick = async () => {
  const patron = [...document.querySelectorAll("[data-patron]")].map((s) => s.value);
  if (!patronValido(patron)) return aviso("Ese patrón no vale.");
  try {
    await updateDoc(doc(db, "turnos", estado.tid), { cuadrante: { patron, rotacion: Number($("cuad-rotacion").value) } });
    aviso("Ajustes guardados");
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
  if (!c.datos) return;
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
