import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, getDoc, getDocs, setDoc, updateDoc, onSnapshot,
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

// La cunda de antes del multiusuario. Solo hace falta para pasarla a la cunda "original".
const LEGADO = [
  { id: "silvia", nombre: "Silvia" },
  { id: "maria", nombre: "María" },
  { id: "curro", nombre: "Curro" },
  { id: "christian", nombre: "Christian" },
];
const ORIGINAL = "original";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const $ = (id) => document.getElementById(id);
const estado = {
  user: null, perfil: { nombre: null, legado: null },
  cundas: [], cundasListas: false,
  cid: null, cunda: null, miembros: [], miembrosListos: false, viajes: [],
  verTodo: false, modoAlta: false, autoAbrir: false, esperandoOriginal: false, saliendo: false,
};
let dejarDeEscucharCundas = null;
let dejarDeEscucharCunda = [];

/* ---------- utilidades ---------- */

const pad = (n) => String(n).padStart(2, "0");
const hoyISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const aFecha = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmtCorta = (iso) =>
  aFecha(iso).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
const fmtLarga = (d) =>
  d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
const signo = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");

const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

function nuevoCodigo() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_");
}

const PANTALLAS = ["cargando", "entrada", "nombre", "cundas", "elegir", "cuenta"];
function mostrar(pantalla) {
  for (const id of PANTALLAS) $(id).hidden = id !== pantalla;
}
const enPantalla = (id) => !$(id).hidden;

let temporizadorAviso;
function aviso(texto, deshacer) {
  $("aviso-texto").textContent = texto;
  const btn = $("aviso-deshacer");
  btn.hidden = !deshacer;
  btn.onclick = deshacer
    ? async () => {
        $("aviso").hidden = true;
        try { await deshacer(); } catch (e) { errorDatos(e); }
      }
    : null;
  $("aviso").hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => ($("aviso").hidden = true), deshacer ? 7000 : 3500);
}

function errorDatos(e) {
  console.error(e);
  aviso(e?.code === "permission-denied"
    ? "Sin permiso. Si no es cosa del admin, cierra la app del todo y ábrela otra vez para actualizarla."
    : "No se ha podido guardar.");
}

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
  for (const k of ["cundapol.yo", "cundapol.nombre", "cundapol.cunda"]) guardar(k, null);
  signOut(auth);
};

/* ---------- invitaciones ---------- */

// El enlace es ...#unirse=<cunda>.<código>. Se guarda por si hay que entrar antes.
function leerInvitacion() {
  const m = location.hash.match(/^#unirse=([\w-]+)\.([\w-]+)$/);
  if (m) {
    guardar("cundapol.invitacion", `${m[1]}.${m[2]}`);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const g = leer("cundapol.invitacion");
  if (!g) return null;
  const [cid, codigo] = g.split(".");
  return { cid, codigo };
}
const enlaceDe = (c) => `${location.origin}${location.pathname}#unirse=${c.id}.${c.codigo}`;

async function unirse({ cid, codigo }) {
  guardar("cundapol.invitacion", null);
  try {
    await updateDoc(doc(db, "cundas", cid), { uids: arrayUnion(estado.user.uid), invitacion: codigo });
  } catch (e) {
    // Puede que ya estuviera dentro y el enlace sea viejo: entonces se abre sin más.
    const dentro = await getDoc(doc(db, "cundas", cid)).then((s) => s.exists(), () => false);
    if (!dentro) {
      console.error(e);
      mostrar("cundas");
      pintarCundas();
      aviso("Ese enlace ya no vale. Pide uno nuevo.");
      return;
    }
  }
  abrirCunda(cid);
}

/* ---------- perfil ---------- */

async function cargarPerfil(user) {
  let datos = {};
  try {
    const snap = await getDoc(doc(db, "perfiles", user.uid));
    if (snap.exists()) datos = snap.data();
  } catch (e) { console.error(e); }
  const legado = LEGADO.find((p) => p.id === (datos.persona ?? leer("cundapol.yo")))?.id ?? null;
  const nombre = datos.nombre ?? LEGADO.find((p) => p.id === legado)?.nombre ?? null;
  const falta = { ...(nombre && !datos.nombre && { nombre }), ...(legado && !datos.persona && { persona: legado }) };
  // La persona hace falta en la nube para entrar en la "original": se espera a que se suba.
  // Sin red no se queda colgado: a los 5 s sigue y se sube cuando vuelva.
  if (Object.keys(falta).length) {
    await Promise.race([
      setDoc(doc(db, "perfiles", user.uid), falta, { merge: true }).catch(console.error),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  if (nombre) guardar("cundapol.nombre", nombre);
  return { nombre, legado };
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
  const habia = estado.perfil.nombre;
  estado.perfil.nombre = nombre;
  guardar("cundapol.nombre", nombre);
  continuar();
  try {
    await setDoc(doc(db, "perfiles", estado.user.uid), { nombre }, { merge: true });
    if (habia && habia !== nombre) await renombrarEnCundas(nombre);
  } catch (e) { errorDatos(e); }
};

// El nombre va también en cada cunda en la que estés.
async function renombrarEnCundas(nombre) {
  for (const c of estado.cundas) {
    const mios = await getDocs(query(collection(db, "cundas", c.id, "miembros"), where("uid", "==", estado.user.uid)));
    await Promise.all(mios.docs.map((d) => updateDoc(d.ref, { nombre })));
  }
}

$("btn-renombrar").onclick = pedirNombre;

/* ---------- tus cundas ---------- */

function escucharCundas() {
  dejarDeEscucharCundas?.();
  estado.cundasListas = false;
  dejarDeEscucharCundas = onSnapshot(
    query(collection(db, "cundas"), where("uids", "array-contains", estado.user.uid)),
    { includeMetadataChanges: true },
    (snap) => {
      estado.cundas = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(porNombre);
      estado.cundasListas ||= !snap.metadata.fromCache;
      pintarCundas();
    },
    (e) => console.error(e),
  );
}

function pintarCundas() {
  if (estado.esperandoOriginal && estado.cundasListas) return aLaOriginal();
  // Recién llegado y con una sola cunda (p. ej. la "original" recién pasada): se abre sola.
  if (estado.autoAbrir && estado.cundas.length === 1 && enPantalla("cundas")) {
    estado.autoAbrir = false;
    return abrirCunda(estado.cundas[0].id);
  }
  $("soy-cundas").textContent = estado.perfil.nombre ?? "";
  $("sin-cundas").hidden = !estado.cundasListas || estado.cundas.length > 0;
  $("lista-cundas").innerHTML = estado.cundas
    .map((c) => `<li><button type="button" data-id="${esc(c.id)}">${esc(c.nombre)}${
      c.admin === estado.user?.uid ? `<span class="admin">la llevas tú</span>` : ""}</button></li>`)
    .join("");
}

$("lista-cundas").onclick = (ev) => {
  const id = ev.target.closest("button")?.dataset.id;
  if (id) abrirCunda(id);
};

$("btn-cambiar").onclick = () => {
  estado.autoAbrir = false;
  mostrar("cundas");
  pintarCundas();
};

$("form-crear").onsubmit = async (ev) => {
  ev.preventDefault();
  const nombre = $("crear-nombre").value.trim().slice(0, 40);
  if (!nombre) return;
  estado.autoAbrir = false;
  const uid = estado.user.uid;
  const ref = doc(collection(db, "cundas"));
  try {
    await setDoc(ref, { nombre, admin: uid, uids: [uid], codigo: nuevoCodigo(), creado: serverTimestamp() });
    await setDoc(doc(ref, "miembros", uid), { nombre: estado.perfil.nombre, uid });
  } catch (e) { errorDatos(e); return; }
  $("crear-nombre").value = "";
  abrirCunda(ref.id);
  abrirInvitar();
};

// La cunda de antes (colección "viajes" suelta) pasa sola a la cunda "original" la primera vez
// que entra cualquiera de los cuatro, con Christian de admin. Cada persona sigue con su id de
// siempre ("silvia", "maria"…) y su cuenta; quien aún no tenga cuenta la reclama al entrar.
async function crearOriginal() {
  const uidsDe = {};
  for (const d of (await getDocs(collection(db, "perfiles"))).docs) {
    const p = d.data().persona;
    if (LEGADO.some((x) => x.id === p)) (uidsDe[p] ??= []).push(d.id);
  }
  (uidsDe[estado.perfil.legado] ??= []).includes(estado.user.uid) || uidsDe[estado.perfil.legado].push(estado.user.uid);
  const admin = uidsDe.christian?.includes(estado.user.uid) ? estado.user.uid : uidsDe.christian?.[0];
  if (!admin) throw new Error("sin-christian");

  const ref = doc(db, "cundas", ORIGINAL);
  const lote = writeBatch(db);
  lote.set(ref, {
    nombre: "Cundapol", admin, uids: [...new Set(Object.values(uidsDe).flat())],
    codigo: nuevoCodigo(), creado: serverTimestamp(),
  });
  for (const p of LEGADO) {
    const suya = uidsDe[p.id]?.includes(estado.user.uid) ? estado.user.uid : uidsDe[p.id]?.[0];
    lote.set(doc(ref, "miembros", p.id), { nombre: p.nombre, uid: suya ?? null, legado: p.id });
  }
  await lote.commit();
}

// Copia a la "original" lo apuntado en la colección vieja que aún no esté (la primera vez, todo;
// luego, lo que se apunte desde una versión vieja de la app mientras la gente actualiza).
let sincronizando = false;
async function sincronizarOriginal() {
  if (sincronizando || !estado.perfil.legado || estado.cid !== ORIGINAL) return;
  sincronizando = true;
  try {
    const ref = doc(db, "cundas", ORIGINAL);
    const desde = (await getDoc(ref)).data()?.sincronizado ?? null;
    const viejos = await getDocs(desde ? query(collection(db, "viajes"), where("creado", ">", desde)) : collection(db, "viajes"));
    if (viejos.empty) return;
    const ya = new Set((await getDocs(collection(ref, "viajes"))).docs.map((d) => d.id));
    let hasta = desde;
    const copias = [];
    for (const d of viejos.docs) {
      const v = d.data();
      const cunda = estado.cunda ?? (await getDoc(ref)).data();
      if (!v.creado || !LEGADO.some((p) => p.id === v.persona) || !cunda?.uids?.includes(v.por)) continue;
      if (!hasta || v.creado.toMillis() > hasta.toMillis()) hasta = v.creado;
      if (!ya.has(d.id)) copias.push(setDoc(doc(ref, "viajes", d.id), v));
    }
    const fallos = (await Promise.allSettled(copias)).filter((r) => r.status === "rejected");
    if (fallos.length) return console.error("sincronizar", fallos[0].reason);
    if (hasta !== desde) await updateDoc(ref, { sincronizado: hasta });
  } catch (e) { console.error(e); } finally { sincronizando = false; }
}

// Uno de los cuatro sin cunda abierta: a la "original", creándola si hace falta.
async function aLaOriginal() {
  estado.esperandoOriginal = false;
  if (!estado.cundas.some((c) => c.id === ORIGINAL)) {
    try { await crearOriginal(); } catch (e) {
      console.error(e);
      if (e?.message === "sin-christian") {
        mostrar("cundas");
        pintarCundas();
        return aviso("Christian tiene que abrir la app primero.");
      }
      // Otro la ha creado a la vez: se abre igual.
    }
  }
  abrirCunda(ORIGINAL);
}

/* ---------- una cunda ---------- */

const yo = () => (estado.miembros.find((m) => m.uid === estado.user?.uid)
  ?? (estado.cid === ORIGINAL && estado.perfil.legado ? estado.miembros.find((m) => m.legado === estado.perfil.legado) : null))?.id ?? null;
const soyAdmin = () => estado.cunda?.admin === estado.user?.uid;
const nombreDe = (id) => estado.miembros.find((m) => m.id === id)?.nombre ?? "?";
// Quien sale o echan queda "fuera": su historial se ve, pero ya no cuenta para la media.
const activos = () => estado.miembros.filter((m) => !m.fuera);

function dejarCunda() {
  for (const f of dejarDeEscucharCunda) f();
  dejarDeEscucharCunda = [];
}

function abrirCunda(cid) {
  dejarCunda();
  Object.assign(estado, { cid, cunda: estado.cundas.find((c) => c.id === cid) ?? null, miembros: [], miembrosListos: false, viajes: [], verTodo: false });
  guardar("cundapol.cunda", cid);
  mostrar("cuenta");
  pintar();

  const fuera = (e) => {
    // Ya no estás o no existe: de vuelta a la lista.
    console.error(e);
    if (estado.cid !== cid) return;
    if (estado.saliendo) return;
    if (estado.cunda?.nombre && e?.code === "permission-denied") aviso(`Ya no estás en «${estado.cunda.nombre}»`);
    dejarCunda();
    guardar("cundapol.cunda", null);
    estado.cid = null;
    mostrar("cundas");
    pintarCundas();
  };
  const ref = doc(db, "cundas", cid);
  dejarDeEscucharCunda = [
    onSnapshot(ref, { includeMetadataChanges: true }, (s) => {
      estado.cunda = s.exists() ? { id: s.id, ...s.data() } : null;
      if (cid === ORIGINAL && s.exists() && !s.metadata.fromCache) sincronizarOriginal();
      pintar();
    }, fuera),
    onSnapshot(collection(ref, "miembros"), { includeMetadataChanges: true }, (snap) => {
      estado.miembros = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(porNombre);
      estado.miembrosListos ||= !snap.metadata.fromCache;
      if (estado.miembrosListos && !yo()) return sinSitio();
      // Volviste con el enlace después de salir: se te vuelve a contar.
      const mio = estado.miembros.find((m) => m.id === yo());
      if (mio?.fuera && mio.uid === estado.user.uid && !estado.saliendo) updateDoc(doc(ref, "miembros", mio.id), { fuera: false }).catch(console.error);
      if (enPantalla("elegir") && yo()) mostrar("cuenta");
      pintar();
    }, fuera),
    onSnapshot(collection(ref, "viajes"), (snap) => {
      estado.viajes = snap.docs.map((d) => {
        const v = d.data({ serverTimestamps: "estimate" });
        return { id: d.id, ...v, creadoMs: v.creado?.toMillis?.() ?? Date.now() };
      });
      pintar();
    }, fuera),
  ];
}

// Estás en la cunda pero aún no eres nadie en ella: o eres alguien sin cuenta, o entras nuevo.
async function sinSitio() {
  const libres = estado.miembros.filter((m) => !m.uid);
  if (!libres.length) return entrarComoNuevo();
  $("elegir-cunda").textContent = estado.cunda?.nombre ?? "";
  $("lista-libres").innerHTML = libres
    .map((m) => `<li><button type="button" data-id="${esc(m.id)}">${esc(m.nombre)}</button></li>`).join("");
  $("btn-soy-nuevo").textContent = `No, soy nuevo: entrar como ${estado.perfil.nombre}`;
  mostrar("elegir");
}

let entrandoNuevo = false;
async function entrarComoNuevo() {
  if (entrandoNuevo) return;
  entrandoNuevo = true;
  try {
    const uid = estado.user.uid;
    await setDoc(doc(db, "cundas", estado.cid, "miembros", uid), { nombre: estado.perfil.nombre, uid });
  } catch (e) { errorDatos(e); } finally { entrandoNuevo = false; }
}

$("lista-libres").onclick = async (ev) => {
  const id = ev.target.closest("button")?.dataset.id;
  if (!id) return;
  try { await updateDoc(doc(db, "cundas", estado.cid, "miembros", id), { uid: estado.user.uid }); } catch (e) { errorDatos(e); }
};
$("btn-soy-nuevo").onclick = entrarComoNuevo;

const apuntar = (persona, dia, n = 1, tipo = "viaje") =>
  addDoc(collection(db, "cundas", estado.cid, "viajes"), { persona, dia, n, tipo, por: estado.user.uid, creado: serverTimestamp() });

/* ---------- pintado ---------- */

function totales() {
  const t = Object.fromEntries(activos().map((m) => [m.id, 0]));
  for (const v of estado.viajes) if (v.persona in t) t[v.persona] += v.n;
  return t;
}

function pintar() {
  if (!enPantalla("cuenta")) return;
  const mio = yo();
  $("cunda-nombre").textContent = estado.cunda?.nombre ?? "Cundapol";
  $("soy").textContent = mio ? nombreDe(mio) : estado.perfil.nombre ?? "";
  $("hoy").textContent = fmtLarga(new Date());

  const t = totales();
  const suma = Object.values(t).reduce((a, b) => a + b, 0);
  const gente = activos();
  const media = gente.length ? suma / gente.length : 0;

  $("libreta").innerHTML = gente.map((p) => {
    const d = Math.round(t[p.id] - media);
    const texto = d === 0 ? "en la media" : d > 0 ? `${d} por encima de la media` : `${Math.abs(d)} por debajo de la media`;
    const nombre = esc(p.nombre);
    return `<li class="fila${p.id === mio ? " mia" : ""}">
      <span class="nom">${nombre}<span class="dif">${texto}</span></span>
      <span class="num" aria-label="${t[p.id]} viajes">${t[p.id]}</span>
      <button class="mas" type="button" data-id="${esc(p.id)}" aria-label="Sumar un viaje a ${nombre}">+1</button>
    </li>`;
  }).join("");
  $("pie-total").textContent = `${suma} trayectos en total · media de ${media.toLocaleString("es-ES", { maximumFractionDigits: 1 })} por cabeza`;

  const puedoQuitar = (v) => v.por === estado.user?.uid || soyAdmin();
  const orden = [...estado.viajes].sort((a, b) => b.dia.localeCompare(a.dia) || b.creadoMs - a.creadoMs);
  const visibles = estado.verTodo ? orden : orden.slice(0, 12);
  $("historial").innerHTML = visibles.length
    ? visibles.map((v) => {
        const es = v.tipo === "ajuste";
        const que = es ? `<span class="ajuste">${esc(nombreDe(v.persona))}: ajuste de cuentas ${signo(v.n)}</span>` : esc(nombreDe(v.persona));
        return `<li><span class="cuando">${fmtCorta(v.dia)}</span><span>${que}</span>${
          puedoQuitar(v) ? `<button class="enlace quitar" type="button" data-id="${esc(v.id)}">quitar</button>` : "<span></span>"}</li>`;
      }).join("")
    : `<li class="vacio">Todavía no hay nada apuntado.</li>`;
  $("btn-ver-todo").hidden = estado.verTodo || orden.length <= 12;
  if ($("dlg-gente").open) pintarGente();
}

/* ---------- acciones ---------- */

const bloqueados = new Set();
$("libreta").onclick = async (ev) => {
  const btn = ev.target.closest(".mas");
  if (!btn || bloqueados.has(btn.dataset.id)) return;
  const id = btn.dataset.id;
  bloqueados.add(id);
  setTimeout(() => bloqueados.delete(id), 700);
  try {
    const ref = await apuntar(id, hoyISO());
    aviso(`${nombreDe(id)}, +1`, () => deleteDoc(ref));
  } catch (e) { errorDatos(e); }
};

$("historial").onclick = async (ev) => {
  const id = ev.target.closest(".quitar")?.dataset.id;
  const v = estado.viajes.find((x) => x.id === id);
  if (!v) return;
  const que = v.tipo === "ajuste" ? "este ajuste" : `el viaje de ${nombreDe(v.persona)} del ${fmtCorta(v.dia)}`;
  if (!confirm(`¿Quitar ${que}?`)) return;
  try { await deleteDoc(doc(db, "cundas", estado.cid, "viajes", id)); aviso("Quitado"); } catch (e) { errorDatos(e); }
};

$("btn-ver-todo").onclick = () => { estado.verTodo = true; pintar(); };

/* otro día */
$("btn-otro-dia").onclick = () => {
  $("dia-quien").innerHTML = activos().map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)}</option>`).join("");
  $("dia-quien").value = yo() ?? "";
  $("dia-fecha").value = hoyISO();
  $("dia-fecha").max = hoyISO();
  $("dlg-dia").showModal();
};
$("dlg-dia").addEventListener("close", async () => {
  if ($("dlg-dia").returnValue !== "ok") return;
  const quien = $("dia-quien").value;
  const dia = $("dia-fecha").value;
  if (!dia || !quien) return;
  try {
    const ref = await apuntar(quien, dia);
    aviso(`${nombreDe(quien)}, +1 el ${fmtCorta(dia)}`, () => deleteDoc(ref));
  } catch (e) { errorDatos(e); }
});

/* ajustar cuentas */
$("btn-ajustar").onclick = () => {
  const t = totales();
  $("ajuste-campos").innerHTML = activos()
    .map((p) => `<label>${esc(p.nombre)}<input type="number" inputmode="numeric" step="1" data-id="${esc(p.id)}" value="${t[p.id]}" required></label>`)
    .join("");
  $("dlg-ajuste").showModal();
};
$("dlg-ajuste").addEventListener("close", async () => {
  if ($("dlg-ajuste").returnValue !== "ok") return;
  const t = totales();
  const cambios = [...$("ajuste-campos").querySelectorAll("input")]
    .map((i) => ({ id: i.dataset.id, delta: Math.round(Number(i.value)) - t[i.dataset.id] }))
    .filter((c) => c.delta !== 0 && Number.isFinite(c.delta));
  if (!cambios.length) return;
  try {
    const refs = await Promise.all(cambios.map((c) => apuntar(c.id, hoyISO(), c.delta, "ajuste")));
    aviso("Cuentas ajustadas", () => Promise.all(refs.map((r) => deleteDoc(r))));
  } catch (e) { errorDatos(e); }
});

/* gente de la cunda */
function abrirGente() {
  pintarGente();
  $("dlg-gente").showModal();
}
$("btn-gente").onclick = abrirGente;

function pintarGente() {
  const admin = soyAdmin();
  const mio = yo();
  $("gente-admin").hidden = !admin;
  if (admin && document.activeElement !== $("gente-nombre")) $("gente-nombre").value = estado.cunda?.nombre ?? "";
  $("gente-lista").innerHTML = activos().map((m) => {
    const etiqueta = m.uid && m.uid === estado.cunda?.admin ? "la lleva" : !m.uid ? "sin cuenta" : m.id === mio ? "tú" : "";
    const botones = admin && m.id !== mio
      ? `${m.uid ? `<button class="enlace" type="button" data-accion="admin" data-id="${esc(m.id)}">pasarle la cunda</button>` : ""}
         <button class="enlace" type="button" data-accion="echar" data-id="${esc(m.id)}">echar</button>`
      : "";
    return `<li><span class="nom">${esc(m.nombre)}${etiqueta ? `<span class="dif">${etiqueta}</span>` : ""}</span><span class="acciones-gente">${botones}</span></li>`;
  }).join("");
  $("btn-salir-cunda").hidden = admin;
  $("gente-nota").textContent = admin
    ? "Para salirte, pásale antes la cunda a otra persona."
    : "Si sales, tus viajes se quedan en el historial pero dejas de contar. Puedes volver con el enlace.";
}

$("btn-gente-nombre").onclick = async () => {
  const nombre = $("gente-nombre").value.trim().slice(0, 40);
  if (!nombre || nombre === estado.cunda?.nombre) return;
  try { await updateDoc(doc(db, "cundas", estado.cid), { nombre }); aviso("Nombre cambiado"); } catch (e) { errorDatos(e); }
};

$("gente-lista").onclick = async (ev) => {
  const btn = ev.target.closest("button[data-accion]");
  const m = estado.miembros.find((x) => x.id === btn?.dataset.id);
  if (!m) return;
  const ref = doc(db, "cundas", estado.cid);
  try {
    if (btn.dataset.accion === "admin") {
      if (!confirm(`${m.nombre} llevará la cunda y tú pasarás a ser uno más. ¿Seguimos?`)) return;
      await updateDoc(ref, { admin: m.uid });
      aviso(`Ahora la lleva ${m.nombre}`);
    } else {
      if (!confirm(`¿Echar a ${m.nombre}? Sus viajes se quedan en el historial pero deja de contar. El enlace de invitación cambia para que no pueda volver con el viejo.`)) return;
      const lote = writeBatch(db);
      lote.update(doc(ref, "miembros", m.id), { fuera: true });
      lote.update(ref, m.uid ? { uids: arrayRemove(m.uid), codigo: nuevoCodigo() } : { codigo: nuevoCodigo() });
      await lote.commit();
      aviso(`${m.nombre} ya no está en la cunda`);
    }
    pintarGente();
  } catch (e) { errorDatos(e); }
};

$("btn-salir-cunda").onclick = async () => {
  const nombre = estado.cunda?.nombre ?? "esta cunda";
  if (!confirm(`¿Salir de «${nombre}»? Tus viajes se quedan en el historial. Para volver necesitarás el enlace.`)) return;
  const ref = doc(db, "cundas", estado.cid);
  const mio = yo();
  try {
    const lote = writeBatch(db);
    if (mio) lote.update(doc(ref, "miembros", mio), { fuera: true });
    lote.update(ref, { uids: arrayRemove(estado.user.uid) });
    estado.saliendo = true; // ni reactivarse ni avisar como si te hubieran echado
    await lote.commit();
    $("dlg-gente").close();
    dejarCunda();
    guardar("cundapol.cunda", null);
    estado.cid = null;
    mostrar("cundas");
    pintarCundas();
    aviso(`Has salido de «${nombre}»`);
  } catch (e) { errorDatos(e); } finally { estado.saliendo = false; }
};

/* invitar */
function abrirInvitar() {
  $("invitar-enlace").value = estado.cunda?.codigo ? enlaceDe(estado.cunda) : "Cargando…";
  $("btn-enlace-nuevo").hidden = !soyAdmin();
  $("dlg-invitar").showModal();
}
$("btn-invitar").onclick = abrirInvitar;

$("btn-compartir").onclick = async () => {
  if (!estado.cunda?.codigo) return;
  const url = enlaceDe(estado.cunda);
  const texto = `Únete a «${estado.cunda.nombre}» en Cundapol para llevar la cuenta de quién lleva el coche:`;
  try {
    if (navigator.share) await navigator.share({ title: "Cundapol", text: texto, url });
    else { await navigator.clipboard.writeText(url); aviso("Enlace copiado"); }
  } catch (e) {
    if (e?.name !== "AbortError") { $("invitar-enlace").select(); aviso("Cópialo a mano"); }
  }
};

$("btn-enlace-nuevo").onclick = async () => {
  if (!confirm("El enlace de ahora dejará de valer para quien no haya entrado todavía. ¿Hacer uno nuevo?")) return;
  const codigo = nuevoCodigo();
  try {
    await updateDoc(doc(db, "cundas", estado.cid), { codigo });
    $("invitar-enlace").value = enlaceDe({ id: estado.cid, codigo });
    aviso("Enlace nuevo hecho");
  } catch (e) { errorDatos(e); }
};

/* ---------- arranque ---------- */

// Después de saber tu nombre: a la invitación, a la última cunda o a la lista.
function continuar() {
  const inv = leerInvitacion();
  if (inv) return unirse(inv);
  const ultima = leer("cundapol.cunda");
  if (ultima) return abrirCunda(ultima);
  if (estado.perfil.legado) {
    // Sin pasar por "Tus cundas": se espera a saber si la "original" existe ya.
    estado.esperandoOriginal = true;
    mostrar("cargando");
    setTimeout(() => {
      if (estado.esperandoOriginal) { estado.esperandoOriginal = false; mostrar("cundas"); pintarCundas(); }
    }, 10000);
    return pintarCundas();
  }
  estado.autoAbrir = true;
  mostrar("cundas");
  pintarCundas();
}

onAuthStateChanged(auth, async (user) => {
  estado.user = user;
  if (!user) {
    dejarDeEscucharCundas?.();
    dejarDeEscucharCundas = null;
    dejarCunda();
    Object.assign(estado, { perfil: { nombre: null, legado: null }, cundas: [], cid: null, cunda: null, miembros: [], viajes: [] });
    mostrar("entrada");
    return;
  }
  escucharCundas();
  // Si este dispositivo ya sabe tu nombre, se entra sin esperar a la red.
  const local = leer("cundapol.nombre");
  if (local) {
    estado.perfil.nombre = local;
    continuar();
    cargarPerfil(user).then((p) => {
      if (estado.user !== user) return;
      estado.perfil = { ...p, nombre: p.nombre ?? local };
      pintarCundas();
    });
    return;
  }
  estado.perfil = await cargarPerfil(user);
  if (estado.user !== user) return;
  if (estado.perfil.nombre) continuar();
  else pedirNombre();
});

// Un enlace de invitación abierto con la app ya en marcha.
window.addEventListener("hashchange", () => {
  if (estado.user && estado.perfil.nombre && location.hash.startsWith("#unirse=")) continuar();
});

/* ---------- versión ---------- */

// Se enseña la versión que está funcionando y, si hay otra publicada, un aviso para actualizar.
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
