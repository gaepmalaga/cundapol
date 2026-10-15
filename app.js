import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, deleteDoc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBTC7Im2qfaZodfhH1Qr_Uey4CGEyVw0Yc",
  authDomain: "cundapol.firebaseapp.com",
  projectId: "cundapol",
  storageBucket: "cundapol.firebasestorage.app",
  messagingSenderId: "607823687265",
  appId: "1:607823687265:web:00efe333cd150d229b4420",
};

const PERSONAS = [
  { id: "silvia", nombre: "Silvia" },
  { id: "maria", nombre: "María" },
  { id: "curro", nombre: "Curro" },
  { id: "christian", nombre: "Christian" },
];
const nombreDe = (id) => PERSONAS.find((p) => p.id === id)?.nombre ?? id;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

const $ = (id) => document.getElementById(id);
const estado = { user: null, yo: null, viajes: [], verTodo: false, modoAlta: false };
let dejarDeEscuchar = null;

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

function mostrar(pantalla) {
  for (const id of ["entrada", "nombre", "cuenta"]) $(id).hidden = id !== pantalla;
}

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
  aviso(e?.code === "permission-denied" ? "Sin permiso para guardar. Avisa a Christian." : "No se ha podido guardar.");
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

$("btn-salir").onclick = () => signOut(auth);

/* ---------- quién eres ---------- */

$("lista-nombres").innerHTML = PERSONAS
  .map((p) => `<li><button type="button" data-id="${p.id}">${p.nombre}</button></li>`)
  .join("");

$("lista-nombres").onclick = async (ev) => {
  const id = ev.target.closest("button")?.dataset.id;
  if (!id || !estado.user) return;
  estado.yo = id;
  try { localStorage.setItem("cundapol.yo", id); } catch {}
  entrarEnCuenta();
  try { await setDoc(doc(db, "perfiles", estado.user.uid), { persona: id }); } catch (e) { errorDatos(e); }
};

$("btn-cambiar").onclick = () => mostrar("nombre");

async function cargarPerfil(user) {
  const ref = doc(db, "perfiles", user.uid);
  try {
    const snap = await getDoc(ref);
    const id = snap.exists() ? snap.data().persona : null;
    if (PERSONAS.some((p) => p.id === id)) return id;
  } catch (e) { console.error(e); }
  let local = null;
  try { local = localStorage.getItem("cundapol.yo"); } catch {}
  if (PERSONAS.some((p) => p.id === local)) {
    // Estaba solo en este dispositivo: se sube para que valga en todos.
    setDoc(ref, { persona: local }).catch((e) => console.error(e));
    return local;
  }
  return null;
}

/* ---------- datos ---------- */

function escuchar() {
  dejarDeEscuchar?.();
  dejarDeEscuchar = onSnapshot(
    collection(db, "viajes"),
    (snap) => {
      estado.viajes = snap.docs.map((d) => {
        const v = d.data({ serverTimestamps: "estimate" });
        return { id: d.id, ...v, creadoMs: v.creado?.toMillis?.() ?? Date.now() };
      });
      pintar();
    },
    errorDatos,
  );
}

function entrarEnCuenta() {
  mostrar("cuenta");
  escuchar();
  pintar();
}

const apuntar = (persona, dia, n = 1, tipo = "viaje") =>
  addDoc(collection(db, "viajes"), { persona, dia, n, tipo, por: estado.user.uid, creado: serverTimestamp() });

/* ---------- pintado ---------- */

function totales() {
  const t = Object.fromEntries(PERSONAS.map((p) => [p.id, 0]));
  for (const v of estado.viajes) if (v.persona in t) t[v.persona] += v.n;
  return t;
}

function pintar() {
  if ($("cuenta").hidden && estado.yo) return;
  $("soy").textContent = nombreDe(estado.yo);
  $("hoy").textContent = fmtLarga(new Date());

  const t = totales();
  const suma = Object.values(t).reduce((a, b) => a + b, 0);
  const media = suma / PERSONAS.length;

  $("libreta").innerHTML = PERSONAS.map((p) => {
    const d = Math.round(t[p.id] - media);
    const texto = d === 0 ? "en la media" : d > 0 ? `${d} por encima de la media` : `${Math.abs(d)} por debajo de la media`;
    return `<li class="fila${p.id === estado.yo ? " mia" : ""}">
      <span class="nom">${p.nombre}<span class="dif">${texto}</span></span>
      <span class="num" aria-label="${t[p.id]} viajes">${t[p.id]}</span>
      <button class="mas" type="button" data-id="${p.id}" aria-label="Sumar un viaje a ${p.nombre}">+1</button>
    </li>`;
  }).join("");
  $("pie-total").textContent = `${suma} trayectos en total · media de ${media.toLocaleString("es-ES", { maximumFractionDigits: 1 })} por cabeza`;

  const orden = [...estado.viajes].sort((a, b) => b.dia.localeCompare(a.dia) || b.creadoMs - a.creadoMs);
  const visibles = estado.verTodo ? orden : orden.slice(0, 12);
  $("historial").innerHTML = visibles.length
    ? visibles.map((v) => {
        const es = v.tipo === "ajuste";
        const que = es ? `<span class="ajuste">${nombreDe(v.persona)}: ajuste de cuentas ${signo(v.n)}</span>` : nombreDe(v.persona);
        return `<li><span class="cuando">${fmtCorta(v.dia)}</span><span>${que}</span>
          <button class="enlace quitar" type="button" data-id="${v.id}">quitar</button></li>`;
      }).join("")
    : `<li class="vacio">Todavía no hay nada apuntado.</li>`;
  $("btn-ver-todo").hidden = estado.verTodo || orden.length <= 12;
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
  try { await deleteDoc(doc(db, "viajes", id)); aviso("Quitado"); } catch (e) { errorDatos(e); }
};

$("btn-ver-todo").onclick = () => { estado.verTodo = true; pintar(); };

/* otro día */
$("dia-quien").innerHTML = PERSONAS.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("");
$("btn-otro-dia").onclick = () => {
  $("dia-quien").value = estado.yo;
  $("dia-fecha").value = hoyISO();
  $("dia-fecha").max = hoyISO();
  $("dlg-dia").showModal();
};
$("dlg-dia").addEventListener("close", async () => {
  if ($("dlg-dia").returnValue !== "ok") return;
  const quien = $("dia-quien").value;
  const dia = $("dia-fecha").value;
  if (!dia) return;
  try {
    const ref = await apuntar(quien, dia);
    aviso(`${nombreDe(quien)}, +1 el ${fmtCorta(dia)}`, () => deleteDoc(ref));
  } catch (e) { errorDatos(e); }
});

/* ajustar cuentas */
$("btn-ajustar").onclick = () => {
  const t = totales();
  $("ajuste-campos").innerHTML = PERSONAS
    .map((p) => `<label>${p.nombre}<input type="number" inputmode="numeric" step="1" data-id="${p.id}" value="${t[p.id]}" required></label>`)
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

/* ---------- arranque ---------- */

onAuthStateChanged(auth, async (user) => {
  estado.user = user;
  if (!user) {
    dejarDeEscuchar?.();
    dejarDeEscuchar = null;
    estado.yo = null;
    estado.viajes = [];
    mostrar("entrada");
    return;
  }
  estado.yo = await cargarPerfil(user);
  if (estado.yo) entrarEnCuenta();
  else mostrar("nombre");
});

// El navegador puede tardar en resolver la sesión: mientras tanto, la entrada.
mostrar("entrada");
