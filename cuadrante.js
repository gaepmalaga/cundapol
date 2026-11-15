// Cuadrante diario de Vacapol: reparto de la gente en equipos y los dos documentos (cuadrante y equipos).
// Aquí no hay nada de Firebase ni del DOM: solo lógica, para poder probarla sola.

export const CICLO_TRABAJO = 6;

// Mañana de 7 a 15, tarde de 15 a 23 y noche de 23 a 7. Cada una se parte en tres franjas de 2 h 40 min.
export const TURNOS = {
  M: { nombre: "MAÑANA", inicio: 7 },
  T: { nombre: "TARDE", inicio: 15 },
  N: { nombre: "NOCHE", inicio: 23 },
};
export const PATRON_POR_DEFECTO = ["M", "M", "T", "T", "N", "N"];
const FRANJA_MIN = 160;

// Tareas en el orden en que se rotan.
export const TAREAS = ["E", "S", "P"];
export const TAREA_TEXTO = {
  E: { normal: "ENTRADA VEHÍCULOS+\u200B", negrita: "REGISTRO", nombre: "Entrada" },
  S: { normal: "SALIDA VEHÍCULOS+\u200B CAMIONES", negrita: "", nombre: "Salida" },
  P: { normal: "PASAJEROS A PIE", negrita: "", nombre: "Pasajeros" },
};
export const COLOR_EQUIPO = ["C00000", "1F3A93", "2E8B3A"];

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const pad = (n) => String(n).padStart(2, "0");
const porNombre = (a, b) => a.nombre.localeCompare(b.nombre, "es");

// El patrón es la lista de 6 letras (una por día de trabajo de la tanda). Si viene mal, el de siempre.
export function patronValido(p) {
  return Array.isArray(p) && p.length === CICLO_TRABAJO && p.every((x) => x in TURNOS);
}

// Franjas de un turno: ["15:00 – 17:40", ...]
export function franjas(turno) {
  const ini = TURNOS[turno].inicio * 60;
  const hhmm = (min) => { const m = ((min % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
  return [0, 1, 2].map((i) => `${hhmm(ini + i * FRANJA_MIN)} – ${hhmm(ini + (i + 1) * FRANJA_MIN)}`);
}
export const horarioTurno = (turno) => `${pad(TURNOS[turno].inicio)}:00 – ${pad((TURNOS[turno].inicio + 8) % 24)}:00`;

// Tarea del equipo e (0-2) en la franja f (0-2). `base` = rotación del ciclo + posición del día:
// cada día todos avanzan una tarea, y cada equipo va una por delante del anterior.
export function tareaDe(base, e, f) {
  return TAREAS[(((base + e + f) % 3) + 3) % 3];
}

// «TARDE 3 NOVIEMBRE DE 2026»
export function titulo(turno, iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${TURNOS[turno].nombre} ${d} ${MESES[m - 1]} DE ${y}`;
}

// Reparte a los disponibles en tres equipos seguidos y casi iguales (11 → 4, 4 y 3), por orden alfabético.
// Los que ocupan un puesto (CRC, OAV, Delfín móvil) no entran. `movidos` = { id: 1|2|3 } para cambios a mano.
export function repartir(disponibles, puestos = {}, movidos = {}) {
  const ocupados = new Set(Object.values(puestos).filter(Boolean));
  const pool = disponibles.filter((p) => !ocupados.has(p.id)).sort(porNombre);
  const n = pool.length;
  const base = Math.floor(n / 3);
  const extra = n % 3;
  const tam = [base + (extra > 0 ? 1 : 0), base + (extra > 1 ? 1 : 0), base];
  const equipos = [[], [], []];
  let i = 0;
  tam.forEach((t, e) => { for (let k = 0; k < t; k++) equipos[e].push(pool[i++]); });
  for (const p of pool) {
    const destino = movidos[p.id];
    if (destino !== 1 && destino !== 2 && destino !== 3) continue;
    const e = equipos.findIndex((eq) => eq.includes(p));
    if (e === destino - 1) continue;
    equipos[e].splice(equipos[e].indexOf(p), 1);
    equipos[destino - 1].push(p);
  }
  for (const eq of equipos) eq.sort(porNombre);
  return equipos;
}

/* ---------- Puestos y equipos de un día (se heredan del día anterior) ---------- */

// Los puestos que se nombran a mano cada día. El Delfín móvil y el Delfín 3 son opcionales.
export const PUESTOS = [
  ["crc", "CRC"],
  ["oav", "OAV"],
  ["delfin", "Delfín móvil"],
  ["delfin3", "Delfín 3"],
];
const CLAVES_PUESTO = PUESTOS.map(([k]) => k);

const conEquipos = (d) => !!d && typeof d.equipos === "object" && d.equipos !== null;

// Lo que se ve de un día. `doc` es lo guardado ese día (o {}), `base` el último cuadrante guardado antes.
//  - Si el día está guardado, se usa tal cual.
//  - Si no, se parte del cuadrante anterior: se quitan los que hoy no están disponibles y los que no
//    estaban en el anterior (volvieron, o entraron) quedan en la bolsa para asignarlos a mano.
//  - Sin nada anterior (o con un cuadrante de la primera versión, sin equipos), se reparte solo.
// Devuelve { origen, puestos, equipos: [[persona]], bolsa: [persona], faltan: [n, n, n] }.
export function resolverDia(disponibles, doc = {}, base = null) {
  const porId = new Map(disponibles.map((p) => [p.id, p]));
  let origen;
  let fuente = null;
  if (conEquipos(doc)) { origen = "guardado"; fuente = doc; }
  else if (Object.keys(doc ?? {}).length) origen = "antiguo";
  else if (conEquipos(base)) { origen = "anterior"; fuente = base; }
  else origen = "auto";

  const puestos = {};
  const ocupados = new Set();
  for (const k of CLAVES_PUESTO) {
    const id = (fuente ?? doc ?? {})[k];
    puestos[k] = id && porId.has(id) && !ocupados.has(id) ? id : null;
    if (puestos[k]) ocupados.add(id);
  }

  let equipos;
  if (fuente) {
    equipos = [[], [], []];
    for (const [id, n] of Object.entries(fuente.equipos)) {
      if (porId.has(id) && !ocupados.has(id) && [1, 2, 3].includes(n)) equipos[n - 1].push(porId.get(id));
    }
    for (const eq of equipos) eq.sort(porNombre);
  } else {
    equipos = repartir(disponibles, puestos, doc?.movidos ?? {});
  }

  const asignados = new Set([...ocupados, ...equipos.flat().map((p) => p.id)]);
  const bolsa = fuente ? disponibles.filter((p) => !asignados.has(p.id)).sort(porNombre) : [];
  // Huecos: cuántos faltan en cada equipo respecto al cuadrante anterior.
  const faltan = [0, 1, 2].map((e) => (conEquipos(base)
    ? Math.max(0, Object.values(base.equipos).filter((n) => n === e + 1).length - equipos[e].length) : 0));
  return { origen, puestos, equipos, bolsa, faltan };
}

// Lo que se guarda de una vista: los puestos (id o nulo) y el equipo de cada uno (id → 1, 2 o 3).
export function docDeVista(v) {
  const d = {};
  for (const k of CLAVES_PUESTO) d[k] = v.puestos[k] ?? null;
  d.equipos = {};
  v.equipos.forEach((eq, e) => { for (const p of eq) d.equipos[p.id] = e + 1; });
  return d;
}

const sacar = (d, id) => {
  for (const k of CLAVES_PUESTO) if (d[k] === id) d[k] = null;
  delete d.equipos[id];
};
// Cambios sobre lo guardado de un día. Devuelven una copia nueva.
export function ponerEnPuesto(d, clave, id) {
  const n = { ...d, equipos: { ...d.equipos } };
  if (id) sacar(n, id);
  n[clave] = id || null; // quien lo ocupaba antes se queda sin asignar (en la bolsa)
  return n;
}
export function ponerEnEquipo(d, id, equipo) {
  const n = { ...d, equipos: { ...d.equipos } };
  sacar(n, id);
  n.equipos[id] = equipo;
  return n;
}
export function mandarALaBolsa(d, id) {
  const n = { ...d, equipos: { ...d.equipos } };
  sacar(n, id);
  return n;
}

/* ---------- HTML (vista previa y PDF por impresión) ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function celdaHtml(t) {
  const x = TAREA_TEXTO[t];
  return `${esc(x.normal)}${x.negrita ? `<b>${esc(x.negrita)}</b>` : ""}`;
}

// d = { turno, iso, base, equipos: [[nombre]], crc, oav, delfin }  (los nombres, ya sueltos)
export function htmlCuadrante(d) {
  const fr = franjas(d.turno);
  const filas = [0, 1, 2].map((e) => `<tr><th style="color:#${COLOR_EQUIPO[e]}">EQUIPO ${e + 1}</th>${
    [0, 1, 2].map((f) => `<td>${celdaHtml(tareaDe(d.base, e, f))}</td>`).join("")}</tr>`).join("");
  return `<div class="doc doc-cuadrante"><h1><span>${esc(titulo(d.turno, d.iso))}</span></h1>
    <table><tr><td class="vacia"></td>${fr.map((x) => `<th>${x}</th>`).join("")}</tr>${filas}</table>
    <p class="pie"><b>CRC:</b> ${esc((d.crc ?? "").toUpperCase())}<br><b>OAV:</b> ${esc((d.oav ?? "").toUpperCase())}<br>
    <b class="pq">DELFÍN MÓVIL${d.delfin ? `:</b> ${esc(d.delfin.toUpperCase())}` : ".</b>"}<br>
    <b class="pq">DELFÍN 3${d.delfin3 ? `:</b> ${esc(d.delfin3.toUpperCase())}` : ".</b>"}</p></div>`;
}

export function htmlEquipos(d) {
  return `<div class="doc doc-equipos">${d.equipos.map((eq, e) =>
    `<p class="eq"><b><u>EQUIPO ${e + 1}:</u></b></p><p class="nm">${eq.map(esc).join("<br>") || "&nbsp;"}</p>`).join("")}</div>`;
}

/* ---------- Word (.docx) ---------- */

// `D` es la librería «docx» cargada (window.docx). Devuelve un Document listo para Packer.toBlob().
export function docxCuadrante(D, d) {
  const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, VerticalAlign, HeightRule } = D;
  const FUENTE = "Times New Roman";
  const borde = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
  const bordes = { top: borde, bottom: borde, left: borde, right: borde };
  const ANCHOS = [1800, 2702, 2702, 2702];
  const celda = (hijos, i, extra = {}) => new TableCell({
    width: { size: ANCHOS[i], type: WidthType.DXA }, borders: bordes, verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 80, right: 80 },
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: hijos })], ...extra,
  });
  const tx = (text, o = {}) => new TextRun({ text, font: FUENTE, size: 26, ...o });

  const cabecera = new TableRow({
    height: { value: 560, rule: HeightRule.ATLEAST },
    children: [celda([], 0), ...franjas(d.turno).map((f, i) => celda([tx(f, { bold: true })], i + 1))],
  });
  const filas = [0, 1, 2].map((e) => new TableRow({
    height: { value: 1700, rule: HeightRule.ATLEAST },
    children: [
      celda([tx(`EQUIPO ${e + 1}`, { bold: true, size: 30, color: COLOR_EQUIPO[e] })], 0),
      ...[0, 1, 2].map((f) => {
        const x = TAREA_TEXTO[tareaDe(d.base, e, f)];
        return celda([tx(x.normal), ...(x.negrita ? [tx(x.negrita, { bold: true })] : [])], f + 1);
      }),
    ],
  }));
  const linea = (etiqueta, valor, size = 32) => new Paragraph({
    indent: { left: 700 }, spacing: { after: 20 },
    children: [tx(`${etiqueta}${valor ? ":" : "."}`, { bold: true, size }), ...(valor ? [tx(` ${valor.toUpperCase()}`, { size })] : [])],
  });
  return new Document({
    sections: [{
      properties: { page: { margin: { top: 1134, bottom: 1134, left: 1000, right: 1000 } } },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { before: 200, after: 360 },
          children: [new TextRun({ text: titulo(d.turno, d.iso), font: FUENTE, size: 56, bold: true, highlight: "yellow" })],
        }),
        new Table({ width: { size: 9906, type: WidthType.DXA }, columnWidths: ANCHOS, rows: [cabecera, ...filas] }),
        new Paragraph({ spacing: { before: 700 }, children: [] }),
        linea("CRC", d.crc ?? ""),
        linea("OAV", d.oav ?? ""),
        // Sin nombre se quedan como «DELFÍN MÓVIL.» y «DELFÍN 3.»
        ...[["DELFÍN MÓVIL", d.delfin], ["DELFÍN 3", d.delfin3]].map(([etiqueta, nombre]) => new Paragraph({
          indent: { left: 700 }, spacing: { after: 20 },
          children: [tx(nombre ? `${etiqueta}:` : `${etiqueta}.`, { bold: true, size: 24 }), ...(nombre ? [tx(` ${nombre.toUpperCase()}`, { size: 24 })] : [])],
        })),
      ],
    }],
  });
}

export function docxEquipos(D, d) {
  const { Document, Paragraph, TextRun, UnderlineType } = D;
  const FUENTE = "Arial";
  const t = (text, o = {}) => new TextRun({ text, font: FUENTE, size: 24, ...o });
  const hijos = [];
  d.equipos.forEach((eq, e) => {
    hijos.push(new Paragraph({ spacing: { before: e ? 240 : 0, after: 200 }, children: [t(`EQUIPO ${e + 1}:`, { bold: true, underline: { type: UnderlineType.SINGLE } })] }));
    for (const nombre of eq) hijos.push(new Paragraph({ indent: { left: 120 }, spacing: { after: 0 }, children: [t(nombre)] }));
  });
  return new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1417, right: 1417 } } }, children: hijos }] });
}

// Nombre de archivo: «Cuadrante TARDE 2026-11-03.docx»
export const nombreArchivo = (clase, turno, iso, ext) => `${clase} ${TURNOS[turno].nombre} ${iso}.${ext}`;
