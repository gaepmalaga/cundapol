// Herramienta de administración de la base de datos de Vacapol. Solo se lanza a mano, desde
// GitHub Actions (.github/workflows/bd-admin.yml), con la cuenta de servicio guardada en el
// secreto FIREBASE_SERVICE_ACCOUNT.
//
// Como el repositorio es público y los registros también, NADA con datos de personas sale en
// claro: se cifra con la clave pública de clave-publica.pem (híbrido RSA-OAEP + AES-256-GCM) y
// solo quien tiene la clave privada puede leerlo.
//
//   node bd.mjs exportar            lee turnos, miembros y días. Solo lectura.
//   node bd.mjs aplicar SI '<plan>' apunta días: plan = [{ "tid", "uid", "dia", "tipo" }].
//                                   Antes saca una copia de los días de esos turnos. Solo crea
//                                   días que no existían; nunca pisa ni borra nada.

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
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
  console.log("Acción desconocida: usa «exportar» o «aplicar».");
  process.exit(1);
}
