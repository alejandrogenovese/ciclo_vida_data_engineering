# Ciclo de Vida del Desarrollo · Data & IA

Aplicación interactiva del modelo operativo de la vertical de Data — Banco Galicia.
Recorre el ciclo de vida etapa por etapa, con narrativa sincronizada, métricas en vivo
desde ServiceNow y vistas adaptadas según el rol de quien la usa.

Pensada para dos audiencias: el **equipo** (operar el día a día) y **management**
(comunicar la estrategia y el estado del modelo).

---

## Vistas

La app tiene cuatro vistas, accesibles desde los tabs del header:

| Tab | Qué muestra |
|-----|-------------|
| **Ciclo de Vida** | El recorrido etapa por etapa, filtrable por equipo solicitante, interacción y tipo de entrega (BAU / Data Product). Cada etapa muestra su narrativa + métricas de ServiceNow. |
| **Arquitectura ↔ Plataforma** | El ciclo de artefactos entre Arquitectura y Plataforma. |
| **Seguimiento** | Kanban de data products posicionados sobre el SVG del ciclo de vida. |
| **Modelo Operativo** | Modelo operativo de Arquitectura Data: capacidades transversales + cómo interactúa con cada rol de la vertical. |
| **⚙ Usuarios** (solo admin) | Gestión local de usuarios. |

---

## Acceso y roles

Al entrar se pide login. Hay dos roles, con credenciales definidas en `app.js`
(`AUTH_USERS`):

| Usuario | Contraseña | Rol | Vista por defecto |
|---------|-----------|-----|-------------------|
| `admin` | `data2024` | admin | Operativa |
| `visor` | `galicia` | visor | Ejecutiva |

> ⚠️ Las credenciales están hardcodeadas en el front (`AUTH_USERS` en `app.js`).
> Es un control de presentación, **no** de seguridad real. Para producción real
> conviene integrar AD/SSO server-side. La integración AD está marcada como pendiente.

### Vista Ejecutiva vs Operativa

El rol determina la vista inicial, y se puede alternar con el botón del header
(👔 Ejecutiva / 🛠 Operativa):

- **Ejecutiva** (default `visor`) — resumen para management. Muestra etapas, estado y
  las métricas clave de cada etapa. Colapsa el detalle: secciones, callouts, sub-pasos,
  items de capacidades, flujos entra/sale del modelo operativo.
- **Operativa** (default `admin`/`editor`) — todo el detalle, para operar el modelo.

Implementado con las clases `body.view-ejecutiva` / `body.view-operativa` (en `style.css`)
y las clases `.mo-detail-only` / `.slo-detail-only` sobre lo que se oculta en ejecutiva.

---

## Estructura del proyecto

```
ciclo_vida_data_engineering/
├── index.html              ← shell de la app + paneles
├── style.css               ← estilos (paleta, tipografías, layout, SLOs, modelo operativo)
├── app.js                  ← lógica (render, navegación, estado, auth, vistas)
├── server.js               ← servidor Node: estáticos + API /api/slo (proxy ServiceNow)
├── data/
│   ├── stages.json                       ← narrativa de cada etapa (por path origen×tipo)
│   ├── diagram.json                      ← nodos, edges y config del diagrama principal
│   ├── architecture-platform.json        ← diagrama tab Arq ↔ Plataforma
│   ├── architecture-platform-stages.json ← narrativa tab Arq ↔ Plataforma
│   ├── actors.json                       ← catálogo de actores (centralizado)
│   ├── cells.json                        ← catálogo de células de negocio
│   └── modelo-operativo.json             ← contenido de la vista Modelo Operativo
├── Dockerfile              ← imagen node:18-alpine
├── docker-compose.yml      ← stack listo (incluye env vars ServiceNow comentadas)
├── package.json
└── render.yaml             ← deploy en Render
```

Para iterar **contenido** solo se tocan los JSON de `data/`. El código no cambia.

---

## API / Backend

`server.js` sirve los archivos estáticos **y** expone una pequeña API:

| Endpoint | Qué hace |
|----------|----------|
| `GET /api/health` | Healthcheck. Indica si ServiceNow está configurado o en modo mock. |
| `GET /api/slo` | Métricas/SLOs por etapa. En prod consulta ServiceNow; sin credenciales devuelve datos **mock** con la misma forma. |

### Métricas por etapa (ServiceNow)

La idea: replicar un kanban en ServiceNow donde cada tarjeta (iniciativa) se asocia a
una etapa del ciclo. El endpoint `/api/slo` consulta la tabla, agrupa por etapa y
devuelve por cada `nodeId`: tarjetas **en curso**, **cerradas**, **total** y **lead time**
promedio. El front lo renderiza dentro del panel de narrativa de cada etapa.

**Modo mock (default).** Sin variables de entorno, `/api/slo` responde con tarjetas de
ejemplo realistas. El front funciona al 100% y muestra un badge `mock`. Cuando se conecta
ServiceNow, el badge pasa a `SNow`.

**Conectar ServiceNow.** Setear estas variables de entorno (ver `docker-compose.yml`):

| Variable | Descripción |
|----------|-------------|
| `SNOW_INSTANCE` | `https://<instancia>.service-now.com` |
| `SNOW_USER` / `SNOW_PASS` | credenciales básicas |
| `SNOW_TOKEN` | Bearer OAuth (alternativa a user/pass) |
| `SNOW_TABLE` | tabla a consultar (default `sn_kanban_task`) |
| `SNOW_MAP_BY` | `tag` o `id` — cómo se asocia la tarjeta a la etapa |
| `SNOW_QUERY` | encoded query opcional (`sysparm_query`) |

**Mapeo tarjeta → etapa.** Configurable por `SNOW_MAP_BY`:
- `tag` (default): la tarjeta lleva una etiqueta que matchea el diccionario `STAGE_TAGS`
  en `server.js`. Editá ese diccionario si en ServiceNow nombrás las etiquetas distinto.
- `id`: el `nodeId` de la etapa viene directo en un campo (`u_stage` / `correlation_id`).

Si ServiceNow falla en runtime, el endpoint degrada a mock (badge `mock`) para no romper
el front, y deja el error en el log del servidor.

---

## Correrlo en local

> ⚠️ El `index.html` no funciona abriéndolo con doble click — el `fetch()` de los JSON
> y de `/api/slo` falla sobre `file://`. Necesitás un servidor HTTP.

### Con Node (recomendado — incluye la API de SLOs)

```bash
cd ciclo_vida_data_engineering
npm install
npm start
# http://localhost:3000   (en modo mock para los SLOs)
```

### Con Python (estáticos solamente, sin API)

```bash
cd ciclo_vida_data_engineering
python3 -m http.server 8080
# http://localhost:8080   — los SLOs no aparecen (no hay /api/slo), el resto sí
```

---

## Editar contenido

### Texto de una etapa del ciclo de vida

`data/stages.json` → `paths` → `<origen-tipo>` (ej. `bs-bau`) → `stages[]`. Cada etapa
tiene `nodeId`, `eyebrow`, `title`, `lead`, `sections[]` y `callout`. El `nodeId` vincula
la narrativa al nodo del diagrama (`data/diagram.json`) y a las métricas de ServiceNow.

### Contenido de la vista Modelo Operativo

`data/modelo-operativo.json`:
- `capabilities[]` — qué hace Arquitectura de forma transversal (cada una con `label`,
  `color`, `summary`, `items[]`).
- `interfaces[]` — cómo interactúa con cada rol (`label`, `color`, `role`, `in`, `out`,
  `interaction`).

### Etiquetas de ServiceNow por etapa

`STAGE_TAGS` en `server.js` — mapea cada `nodeId` a las etiquetas que matchean en SNow.

---

## Deploy

### Render

Hay `render.yaml` (runtime docker). Para que `/api/slo` consulte ServiceNow real, cargar
las variables `SNOW_*` en el dashboard de Render.

### NUC / Docker

```bash
docker compose up -d
# http://192.168.1.89:3000   (o el puerto que mapees)
```

Para conectar ServiceNow, descomentar las variables `SNOW_*` en `docker-compose.yml`.

### Roadmap — persistencia del kanban de Seguimiento

Hoy el kanban de **Seguimiento** persiste en `localStorage` del navegador (clave
`cvd_seguimiento`), pensado para Render. Cuando se lleve a **OCP o ECS**, la idea es mover
el estado a una **DB clave-valor** (DynamoDB si va a ECS, Redis/Valkey con persistencia si
va a OCP), detrás de una capa `store` con `get/put/list/delete` para no atar el código al
destino. Pendiente hasta definir dónde se hostea.

---

## Atajos de teclado

| Tecla | Acción |
|-------|--------|
| `←` / `→` | Etapa anterior / siguiente |
| `Space` | Play / Pause auto-play |
| `R` | Reiniciar |
| `+` / `−` / `0` | Zoom in / out / reset |

---

## Stack técnico

- HTML5 + CSS3 + Vanilla JS (módulos ES nativos), sin frameworks ni build step.
- SVG generado dinámicamente desde JSON.
- Backend Node nativo (`http`/`https`), sin dependencias en producción.
- Google Fonts: Instrument Serif + Geist + Geist Mono.

## Decisiones de diseño

- **Data separada de código**: el contenido vive en `data/*.json`.
- **Backend mínimo**: `server.js` sirve estáticos y hace de proxy a ServiceNow
  (credenciales server-side, nunca en el browser).
- **Mock con la misma forma que prod**: el front no distingue mock de real salvo por un
  badge; conectar ServiceNow no requiere tocar el front.
- **Colores espejados del drawio original**: quien vio el .drawio reconoce el mapa.
- **Vista por rol**: una sola app sirve para operar (operativa) y comunicar (ejecutiva).
