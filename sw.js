// Deja abrir la app sin cobertura. Los datos de Firestore NO pasan por aquí:
// los guarda su propia caché y se sincronizan cuando vuelve la señal.
const CACHE = "cundapol-v6";
const BASICOS = ["./", "index.html", "vacaciones.html", "style.css", "app.js", "vacaciones.js", "version.js", "icon.svg", "manifest.webmanifest", "vacaciones.webmanifest"];

// Solo lo nuestro y lo que se descarga como librería o tipografía.
const HOSTS_CACHEABLES = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASICOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const propio = url.origin === self.location.origin;
  if (!propio && !HOSTS_CACHEABLES.includes(url.hostname)) return;

  // Lo propio: primero la red, para no mezclar versiones; sin red, lo guardado.
  if (propio) {
    ev.respondWith(
      fetch(req, { cache: "no-cache" }) // GitHub Pages deja la caché HTTP en 10 min
        .then((resp) => {
          if (resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (await cache.match(req, { ignoreSearch: true }))
            ?? (req.mode === "navigate" ? await cache.match("index.html") : undefined)
            ?? Response.error();
        }),
    );
    return;
  }

  // Librerías y tipografías: lo guardado al instante y se refresca por detrás.
  ev.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardado = await cache.match(req, { ignoreSearch: propio });
      const red = fetch(req)
        .then((resp) => {
          if (resp && (resp.ok || resp.type === "opaque")) cache.put(req, resp.clone());
          return resp;
        })
        .catch(() => null);
      if (guardado) {
        ev.waitUntil(red);
        return guardado;
      }
      const resp = await red;
      if (resp) return resp;
      if (req.mode === "navigate") return (await cache.match("index.html")) ?? Response.error();
      return Response.error();
    }),
  );
});
