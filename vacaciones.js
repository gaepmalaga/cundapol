import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, deleteDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
  query, where, arrayUnion, arrayRemove, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { VERSION } from "./version.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTC7Im2qfaZodfhH1Qr_Uey4CGEyVw0Yc",
  authDomain: "cundapol.firebaseapp.com",
  projectId: "cundapol",
  storageBucket: "cundapol.firebasestorage.app",
  messagingSenderId: "607823687265",
  appId: "1:607823687265:web:00efe333cd150d229b4420",
};

// Se trabajan 6 días y se libran 6.
const TRABAJO = 6;
const CICLO = 12;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const $ = (id) => document.getElementById(id);
const estado = {
  user: null, perfil: { nombre: null },
  turnos: [], turnosListos: false,
  tid: null, turno: null, miembros: [], dias: [], mes: null, sel: null,
  vista: "mes",
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

function nuevoCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_");
}

const PANTALLAS = ["cargando", "entrada", "nombre", "turnos", "cuenta"];
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
  "auth/invalid-credential": "Correo o contraseña no válidos.",
  "auth/wrong-password": "Correo o contraseña no válidos.",
  "auth/user-not-found": "Correo o contraseña no válidos.",
  "auth/invalid-email": "Ese correo no parece válido.",
  "auth/email-already-in-use": "Ese correo ya tiene cuenta. Prueba a entrar.",
  "auth/weak-password": "La contraseña necesita al menos 6 caracteres.",
  "auth/too-many-requests": "Demasiados intentos. Espera un rato.",
  "auth/network-request-failed": "Sin conexión.",
  "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase.",
};
function errorEntrada(e) {
  if (e?.code === "auth/popup-closed-by-user" || e?.code === "auth/cancelled-popup-request") return;
  const p = $("error-entrada");
  p.textContent = MENSAJES[e?.code] ?? "No se ha podido entrar.";
  p.hidden = false;
}

$("btn-google").onclick = async () => {
  $("error-entrada").hidden = true;
  try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { errorEntrada(e); }
};

$("form-correo").onsubmit = async (ev) => {
  ev.preventDefault();
  $("error-entrada").hidden = true;
  const correo = $("correo").value.trim();
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
  $("clave").autocomplete = estado.modoAlta ? "new-password" : "current-password";
  $("error-entrada").hidden = true;
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
      t.admin === estado.user?.uid ? `<span class="admin">lo llevas tú</span>` : ""}</button></li>`)
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

const soyAdmin = () => estado.turno?.admin === estado.user?.uid;

function dejarTurno() {
  for (const f of dejarDeEscucharTurno) f();
  dejarDeEscucharTurno = [];
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
  $("soy").textContent = estado.perfil.nombre ?? "";
  $("mes-titulo").textContent = fmtMes(estado.mes);
  for (const b of document.querySelectorAll("[data-vista]")) b.setAttribute("aria-pressed", String(b.dataset.vista === estado.vista));
  $("vista-mes").hidden = estado.vista !== "mes";
  $("vista-lista").hidden = estado.vista !== "lista";

  const pedidos = new Map(); // día → [uid]
  for (const d of dias) {
    if (!pedidos.has(d.dia)) pedidos.set(d.dia, []);
    pedidos.get(d.dia).push(d.uid);
  }
  const quienes = (iso) => (pedidos.get(iso) ?? []).map((u) => ({ u, nombre: gente.get(u) })).sort(porNombre);

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
  const cuentas = new Map([...gente.keys()].map((u) => [u, 0]));
  for (const d of dias) if (d.dia.startsWith(`${y}-`)) cuentas.set(d.uid, cuentas.get(d.uid) + 1);
  $("recuento").innerHTML = [...cuentas]
    .map(([u, n]) => ({ u, nombre: gente.get(u), n }))
    .sort(porNombre)
    .map((p) => `<li><span class="nom">${esc(p.nombre)}${p.u === uid ? `<span class="dif">tú</span>` : ""}</span><span class="num">${p.n}</span></li>`)
    .join("");

  if ($("dlg-gente").open) pintarGente();
}

// Calendario del mes: cada día de trabajo se oscurece cuanta más gente lo pide.
function pintarMes({ y, m, ultimo, hoy, iso, laborables, quienes, pedidos, uid }) {
  const max = Math.max(1, ...laborables.map((d) => quienes(d).length));
  const primero = (new Date(y, m, 1).getDay() + 6) % 7; // lunes primero
  let celdas = "";
  for (let i = 0; i < primero; i++) celdas += `<div class="cel vacia"></div>`;
  for (let n = 1; n <= ultimo; n++) {
    const d = iso(n);
    const clases = `${d < hoy ? " pasado" : ""}${d === hoy ? " hoy-cel" : ""}`;
    if (!laborables.includes(d)) { celdas += `<div class="cel${clases}"><span class="d">${n}</span></div>`; continue; }
    const cuantos = quienes(d).length;
    const t = cuantos / max;
    const mio = pedidos.get(d)?.includes(uid);
    celdas += `<button class="cel trab${clases}${mio ? " mio" : ""}${t > 0.55 ? " fuerte" : ""}${estado.sel === d ? " sel" : ""}" type="button" data-sel="${d}"
      style="background: color-mix(in srgb, var(--marca) ${Math.round(cuantos ? 12 + t * 80 : 0)}%, var(--papel-2)); ${t > 0.55 ? "color: #fff" : ""}"
      aria-label="${esc(fmtLargo(d))}, ${cuantos} ${cuantos === 1 ? "persona" : "personas"}"><span class="d">${n}</span><span class="n">${cuantos || ""}</span></button>`;
  }
  $("rejilla").innerHTML = celdas;
  $("leyenda-max").textContent = `Muchos (${max})`;

  const d = estado.sel;
  if (!d) { $("detalle").innerHTML = `<p class="nota">Toca un día para ver quién lo ha pedido.</p>`; return; }
  const q = quienes(d);
  const mio = q.some((x) => x.u === uid);
  $("detalle").innerHTML = `<h4>${esc(fmtLargo(d))}<small>${q.length} ${q.length === 1 ? "persona" : "personas"}</small></h4>
    <div class="chips">${q.map((x) => `<span class="chip${x.u === uid ? " yo" : ""}">${esc(x.nombre)}</span>`).join("") || `<span class="nota">Nadie todavía.</span>`}</div>
    <button class="btn-yo${mio ? " quitar" : ""}" type="button" data-dia="${d}">${mio ? "Quitar mis vacaciones este día" : "Pedir este día"}</button>`;
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
    const todos = g.dias.every((d) => pedidos.get(d)?.includes(uid));
    const filas = g.dias.map((d) => {
      const q = quienes(d);
      const mio = q.some((x) => x.u === uid);
      const nombres = q.map((x) => x.u === uid ? `<b>${esc(x.nombre)}</b>` : esc(x.nombre)).join(", ");
      return `<button class="fila-dia${mio ? " mia" : ""}${d === hoy ? " hoy-dia" : ""}${d < hoy ? " pasado" : ""}" type="button" data-dia="${d}" aria-pressed="${mio}" aria-label="Vacaciones el ${esc(fmtLargo(d))}">
        <span class="cu">${esc(dia3(d))}<small>${Number(d.slice(8))}</small></span>
        <span class="qu">${nombres || `<span class="nadie">—</span>`}</span>
        <span class="co">${q.length || ""}</span><span class="ck">✓</span></button>`;
    }).join("");
    return `<div class="grupo"><div class="grupo-cab"><span>${esc(fmtRango(g.dias[0]))} – ${esc(fmtRango(g.dias.at(-1)))}</span>
      <button class="enlace" type="button" data-tanda="${g.dias.join(",")}" data-quitar="${todos}">${todos ? "Quitar todos" : "Pedir todos"}</button></div>${filas}</div>`;
  }).join("") || `<p class="vacio">Este mes no hay días de trabajo.</p>`;
}

function moverMes(delta) {
  estado.mes = new Date(estado.mes.getFullYear(), estado.mes.getMonth() + delta, 1);
  pintar();
}
$("mes-ant").onclick = () => moverMes(-1);
$("mes-sig").onclick = () => moverMes(1);

for (const b of document.querySelectorAll("[data-vista]")) {
  b.onclick = () => { estado.vista = b.dataset.vista; guardar("vacaciones.vista", estado.vista); pintar(); };
}

const idDia = (uid, dia) => `${uid}_${dia}`;
const refDia = (dia) => doc(db, "turnos", estado.tid, "dias", idDia(estado.user.uid, dia));

$("cuenta").addEventListener("click", async (ev) => {
  const uid = estado.user.uid;
  const mios = new Set(estado.dias.filter((d) => d.uid === uid).map((d) => d.dia));
  const btnSel = ev.target.closest("button[data-sel]");
  const btnDia = ev.target.closest("button[data-dia]");
  const btnTanda = ev.target.closest("button[data-tanda]");
  if (btnSel) { estado.sel = btnSel.dataset.sel; return pintar(); }
  try {
    if (btnDia) {
      const dia = btnDia.dataset.dia;
      if (mios.has(dia)) await deleteDoc(refDia(dia));
      else await setDoc(refDia(dia), { uid, dia });
    } else if (btnTanda) {
      const lote = writeBatch(db);
      const quitar = btnTanda.dataset.quitar === "true";
      for (const dia of btnTanda.dataset.tanda.split(",")) {
        if (quitar) lote.delete(refDia(dia));
        else if (!mios.has(dia)) lote.set(refDia(dia), { uid, dia });
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
  $("gente-lista").innerHTML = [...estado.miembros].sort(porNombre).map((m) => {
    const etiqueta = m.id === estado.turno?.admin ? "lo lleva" : m.id === yo ? "tú" : "";
    const botones = admin && m.id !== yo
      ? `<button class="enlace" type="button" data-accion="admin" data-id="${esc(m.id)}">pasarle el turno</button>
         <button class="enlace" type="button" data-accion="echar" data-id="${esc(m.id)}">echar</button>`
      : "";
    return `<li><span class="nom">${esc(m.nombre)}${etiqueta ? `<span class="dif">${etiqueta}</span>` : ""}</span><span class="acciones-gente">${botones}</span></li>`;
  }).join("");
  $("btn-salir-turno").hidden = admin;
  $("gente-nota").textContent = admin
    ? "Para salirte, pásale antes el turno a otra persona."
    : "Si sales, tus días dejan de contar. Puedes volver con el enlace.";
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
      if (!confirm(`${m.nombre} llevará el turno y tú pasarás a ser uno más. ¿Seguimos?`)) return;
      await updateDoc(ref, { admin: m.id });
      aviso(`Ahora lo lleva ${m.nombre}`);
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
    const lote = writeBatch(db);
    lote.delete(doc(ref, "miembros", estado.user.uid));
    lote.update(ref, { uids: arrayRemove(estado.user.uid) });
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
