// Herramienta de administración de la base de datos de Vacapol. Solo se lanza a mano, desde
// GitHub Actions (.github/workflows/bd-admin.yml), con la cuenta de servicio guardada en el
// secreto FIREBASE_SERVICE_ACCOUNT.
//
// Como el repositorio es público y los registros también, NADA con datos de personas sale en
// claro: se cifra con la clave pública de clave-publica.pem (híbrido RSA-OAEP + AES-256-GCM) y
// solo quien tiene la clave privada puede leerlo.
//
//   node bd.mjs exportar            lee turnos, miembros y días. Solo lectura.
//   node bd.mjs perfiles            lee los perfiles (uid → nombre) y las cundas (quién está dentro, sin
//                                   el código del enlace). Solo lectura.
//   node bd.mjs probar <tid> <uid,uid…>
//                                   hace lo mismo que la app para cada uid (inicia sesión con un token
//                                   hecho con la clave, como ese usuario): la consulta de «tus turnos», la
//                                   lectura del turno y de sus miembros y días. Solo lectura. Sirve para ver
//                                   si un usuario ve su turno con las reglas publicadas.
//   node bd.mjs aplicar SI '<plan>' apunta días: plan = [{ "tid", "uid", "dia", "tipo" }].
//                                   Antes saca una copia de los días de esos turnos. Solo crea
//                                   días que no existían; nunca pisa ni borra nada.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth as getAuthAdmin } from "firebase-admin/auth";
import crypto from "node:crypto";
import fs from "node:fs";

const [accion, confirmar = "", planTexto = ""] = process.argv.slice(2);
const TIPOS = ["vac", "ss", "nav", "ap", "otros"];

// Con el emulador de Firestore (pruebas) no hace falta credencial.
const credencial = process.env.FIREBASE_SERVICE_ACCOUNT;
initializeApp(credencial ? { credential: cert(JSON.parse(credencial)) } : { projectId: "demo-cunda" });
const db = getFirestore();

function cifrar(obj) {
  const publica = fs.readFileSync(new URL("./clave-publica.pem", import.meta.url), "utf8");
  const clave = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const aes = crypto.createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([aes.update(JSON.stringify(obj), "utf8"), aes.final()]);
  const claveCifrada = crypto.publicEncrypt(
    { key: publica, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, clave);
  return Buffer.from(JSON.stringify({
    k: claveCifrada.toString("base64"), iv: iv.toString("base64"),
    t: aes.getAuthTag().toString("base64"), c: datos.toString("base64"),
  })).toString("base64");
}
function imprimirCifrado(titulo, obj) {
  const b64 = cifrar(obj);
  console.log(`#### INICIO ${titulo}`);
  for (let i = 0; i < b64.length; i += 160) console.log(b64.slice(i, i + 160));
  console.log(`#### FIN ${titulo}`);
}

// Los datos de uno o de todos los turnos, tal como están.
async function leerTurnos(ids) {
  const snap = ids ? await Promise.all(ids.map((id) => db.collection("turnos").doc(id).get())) : (await db.collection("turnos").get()).docs;
  const salida = [];
  for (const t of snap) {
    if (!t.exists) continue;
    const d = t.data();
    const [m, dias] = await Promise.all([t.ref.collection("miembros").get(), t.ref.collection("dias").get()]);
    salida.push({
      id: t.id, nombre: d.nombre, inicio: d.inicio, admin: d.admin, admins: d.admins ?? [], uids: d.uids ?? [],
      miembros: m.docs.map((x) => ({ id: x.id, ...x.data() })),
      dias: dias.docs.map((x) => ({ id: x.id, ...x.data() })),
    });
  }
  return salida;
}

if (accion === "exportar") {
  const turnos = await leerTurnos();
  console.log(`Turnos leídos: ${turnos.length}. Días en total: ${turnos.reduce((n, t) => n + t.dias.length, 0)}.`);
  imprimirCifrado("EXPORTACION", turnos);
} else if (accion === "perfiles") {
  const perfiles = (await db.collection("perfiles").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const cundas = (await db.collection("cundas").get()).docs.map((d) => {
    const c = d.data();
    return { id: d.id, nombre: c.nombre, admin: c.admin, uids: c.uids ?? [] }; // sin el código del enlace
  });
  console.log(`Perfiles leídos: ${perfiles.length}. Cundas leídas: ${cundas.length}.`);
  imprimirCifrado("PERFILES", { perfiles, cundas });
} else if (accion === "probar") {
  const tid = confirmar;
  const uids = planTexto.split(",").map((x) => x.trim()).filter(Boolean);
  if (!tid || !uids.length) { console.log("Uso: probar <tid> <uid,uid…> (el tid va en «confirmar» y los uid en «plan»)."); process.exit(1); }
  const { initializeApp: iniciarCliente } = await import("firebase/app");
  const { getAuth, signInWithCustomToken, connectAuthEmulator } = await import("firebase/auth");
  const F = await import("firebase/firestore");
  const config = { apiKey: "AIzaSyBTC7Im2qfaZodfhH1Qr_Uey4CGEyVw0Yc", authDomain: "cundapol.firebaseapp.com", projectId: process.env.FIRESTORE_EMULATOR_HOST ? "demo-cunda" : "cundapol" };
  const codigo = (e) => e?.code ?? e?.message ?? String(e);
  for (const uid of uids) {
    const etiqueta = `…${uid.slice(-6)}`;
    const app = iniciarCliente(config, `prueba-${uid}`);
    const auth = getAuth(app);
    const db = F.getFirestore(app);
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
      F.connectFirestoreEmulator(db, ...process.env.FIRESTORE_EMULATOR_HOST.split(":"));
    }
    try { await signInWithCustomToken(auth, await getAuthAdmin().createCustomToken(uid)); } catch (e) { console.log(`${etiqueta}: no se pudo iniciar sesión: ${codigo(e)}`); continue; }
    const intenta = async (nombre, fn) => { try { console.log(`${etiqueta} · ${nombre}: ${await fn()}`); } catch (e) { console.log(`${etiqueta} · ${nombre}: ERROR ${codigo(e)}`); } };
    await intenta("consulta «tus turnos» (uids array-contains uid)", async () => {
      const s = await F.getDocs(F.query(F.collection(db, "turnos"), F.where("uids", "array-contains", uid)));
      return `${s.size} resultado(s) ${s.docs.map((d) => d.id).join(",")} (de caché: ${s.metadata.fromCache})`;
    });
    await intenta(`leer turno ${tid}`, async () => { const d = await F.getDoc(F.doc(db, "turnos", tid)); return d.exists() ? `existe, ${(d.data().uids ?? []).length} uids, está dentro: ${(d.data().uids ?? []).includes(uid)}` : "no existe"; });
    await intenta("leer miembros", async () => `${(await F.getDocs(F.collection(db, "turnos", tid, "miembros"))).size}`);
    await intenta("leer días", async () => `${(await F.getDocs(F.collection(db, "turnos", tid, "dias"))).size}`);
  }
  process.exit(0);
} else if (accion === "aplicar") {
  if (confirmar !== "SI") { console.log("No se escribe nada: falta confirmar con SI."); process.exit(1); }
  let plan;
  try { plan = JSON.parse(planTexto); } catch { console.log("El plan no es un JSON válido."); process.exit(1); }
  if (!Array.isArray(plan) || !plan.length) { console.log("El plan está vacío."); process.exit(1); }

  // Se comprueba todo antes de escribir nada.
  const turnos = new Map((await leerTurnos([...new Set(plan.map((p) => p.tid))])).map((t) => [t.id, t]));
  const validos = [];
  const rechazados = [];
  for (const p of plan) {
    const t = turnos.get(p.tid);
    const ok = t && typeof p.uid === "string" && t.uids.includes(p.uid)
      && /^\d{4}-\d{2}-\d{2}$/.test(p.dia ?? "") && TIPOS.includes(p.tipo);
    (ok ? validos : rechazados).push(p);
  }
  console.log(`Plan: ${plan.length} · válidos: ${validos.length} · rechazados: ${rechazados.length}.`);
  if (rechazados.length) imprimirCifrado("RECHAZADOS", rechazados);
  if (rechazados.length) { console.log("Hay entradas inválidas: no se escribe nada."); process.exit(1); }

  imprimirCifrado("COPIA_ANTES", [...turnos.values()].map((t) => ({ id: t.id, dias: t.dias })));

  let creados = 0;
  let yaEstaban = 0;
  for (const p of validos) {
    try {
      await db.doc(`turnos/${p.tid}/dias/${p.uid}_${p.dia}`).create({ uid: p.uid, dia: p.dia, tipo: p.tipo });
      creados++;
    } catch (e) {
      if (e.code === 6) yaEstaban++; // ALREADY_EXISTS: no se pisa
      else throw e;
    }
  }
  console.log(`Creados: ${creados} · ya estaban: ${yaEstaban}.`);
} else {
  console.log("Acción desconocida: usa «exportar», «perfiles», «probar» o «aplicar».");
  process.exit(1);
}
