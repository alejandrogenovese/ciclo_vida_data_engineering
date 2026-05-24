# Ciclo de Vida del Desarrollo · Data & IA

Storyline interactivo del modelo operativo de Data — Banco Galicia.

Diagrama interactivo donde se recorre el ciclo de vida etapa por etapa, con narrativa
sincronizada. Pensado para que distintas áreas (negocio, modelado, ingeniería, gobierno,
plataforma) entiendan el modelo desde su perspectiva.

---

## Estructura del proyecto

```
ciclo-vida-data/
├── index.html              ← shell mínimo de la app
├── style.css               ← estilos (paleta, tipografías, layout)
├── app.js                  ← lógica (render, navegación, estado)
├── data/
│   ├── stages.json         ← contenido narrativo de cada etapa
│   └── diagram.json        ← posiciones de nodos, edges y config global
├── Dockerfile              ← imagen nginx-alpine para deploy en el NUC
├── docker-compose.yml      ← stack listo para levantar
└── README.md
```

Para iterar el modelo solo se tocan los dos JSON de `data/`. El código no cambia.

---

## Correrlo en local

> ⚠️ **Importante:** el `index.html` no funciona abriéndolo con doble click.
> El `fetch()` de los JSON falla por CORS sobre `file://`. Necesitás un servidor HTTP.

### Opción A — Python (rápido, sin dependencias)

```bash
cd ciclo-vida-data
python3 -m http.server 8080
# abrí http://localhost:8080
```

### Opción B — VS Code + Live Server

1. Abrí la carpeta en VS Code
2. Instalá la extensión **Live Server** (Ritwick Dey)
3. Click derecho en `index.html` → "Open with Live Server"
4. Cada vez que guardás un archivo, el browser recarga solo.

### Opción C — Node serve

```bash
npx serve .
```

---

## Editar el contenido

### Cambiar texto de una etapa

Abrí `data/stages.json`. Cada elemento del array es una etapa. Estructura:

```json
{
  "nodeId": "business-solution",
  "eyebrow": "Origen · Demanda funcional",
  "title": "La iniciativa <span class=\"italic\">nace en el negocio</span>",
  "lead": "Texto principal en gris…",
  "sections": [
    { "label": "Participan", "content": "<div class=\"pill-grid\"><span class=\"pill\">DMs</span></div>" },
    { "label": "Entrada", "content": "Texto…" }
  ],
  "callout": "<strong>Para todos:</strong> texto destacado al final.",
  "color": { "primary": "#FF8C00", "soft": "#FFF3E0" }
}
```

- `nodeId` debe coincidir con un `id` declarado en `data/diagram.json` (es el vínculo
  entre la narrativa y el nodo del diagrama).
- HTML está permitido dentro de `lead`, `sections.content`, `callout`. Usá `<strong>`,
  `<span class="italic">`, `<span class="pill">`, `<div class="pill-grid">`.
- `color.primary` se usa para el dot, el título destacado y el border del callout.

### Agregar una etapa nueva

Tocás los dos JSON:

**1. En `data/stages.json`** — agregá un objeto al final del array con la estructura de
arriba. El `nodeId` define a qué nodo del diagrama se vincula.

**2. En `data/diagram.json`** — agregá tres cosas:

a) Un nuevo nodo al array `nodes`:

```json
{
  "id": "mi-etapa-nueva",
  "stageIndex": 11,
  "shape": "rect",
  "geom": { "x": 30, "y": 50, "w": 140, "h": 60, "rx": 4 },
  "labelPos": { "numY": 71, "labelY": 92 },
  "pulse": { "cx": 100, "cy": 80, "r": 60 },
  "num": "11",
  "label": "Mi Etapa",
  "colorVar": "--c-bs"
}
```

- `stageIndex` debe coincidir con la posición del objeto en `stages.json` (0-indexed).
- `shape` soporta `rect`, `pill` (rect con rx grande) y `hexagon` (definís `points`).
- `colorVar` debe ser una variable CSS declarada en `style.css` (busca `--c-` en `:root`).

b) Edges que conectan al nuevo nodo en el array `edges`:

```json
{
  "id": "e-anterior-mia",
  "d": "M 360 940 L 360 980",
  "activeAt": [11],
  "pastFrom": 11
}
```

- `d` es el `path` SVG. Si no querés calcularlo a mano, podés abrir `index.html` en
  el browser, inspeccionar los edges existentes y copiar/adaptar coordenadas.
- `activeAt` es el array de `stageIndex` donde el edge se muestra resaltado.
- `pastFrom` es el `stageIndex` a partir del cual el edge queda en estado "pasado".

c) Si querés cambiar el color de la nueva etapa, agregá la variable CSS en `style.css`:

```css
:root {
  --c-mi-etapa: #FF5733;
}
```

### Mover un nodo

En `data/diagram.json`, ajustá `geom.x` / `geom.y` del nodo. Acordate de ajustar
también `pulse.cx` / `pulse.cy` (centro del pulso) y `labelPos.numY` / `labelPos.labelY`
(posición del texto), o no van a quedar centrados.

Si moviste un nodo, los edges que entran o salen de él probablemente queden mal —
ajustá las coordenadas del `d` del edge correspondiente.

### Cambiar el branding (logo, título, organización)

En `data/diagram.json`, sección `config.brand`:

```json
"config": {
  "brand": {
    "mark": "Modelo Operativo",
    "title": "Ciclo de Vida del Desarrollo <em>· Data &amp; IA</em>",
    "org": "Banco Galicia"
  }
}
```

### Cambiar la velocidad del auto-play

En `data/diagram.json`, sección `config`:

```json
"config": {
  "autoplayMs": 6500
}
```

Valor en milisegundos por etapa.

---

## Deploy en el NUC

Hay un `Dockerfile` y un `docker-compose.yml` listos. Imagen `nginx:alpine`, sin build
step, sirve los archivos estáticos.

```bash
# Desde la carpeta del proyecto
docker compose up -d
# Disponible en http://192.168.1.89:8090
```

Para parar:

```bash
docker compose down
```

Para actualizar contenido sin rebuild: editá los JSON en `data/`, no hace falta
reiniciar el container porque están bind-mounted como volumen.

Si querés exponerlo bajo un subdominio detrás de Nginx Proxy Manager, apuntá a
`http://192.168.1.89:8090` y listo.

---

## Atajos de teclado

| Tecla | Acción |
|-------|--------|
| `←` | Etapa anterior |
| `→` | Etapa siguiente |
| `Space` | Play / Pause auto-play |
| `R` | Reiniciar al inicio |

---

## Stack técnico

- HTML5 + CSS3 + Vanilla JS (módulos ES nativos)
- SVG generado dinámicamente desde JSON
- Google Fonts: Instrument Serif + Geist + Geist Mono
- Sin frameworks. Sin build step. Sin dependencias npm.

---

## Decisiones de diseño

- **Data separada de código**: agregar etapas no requiere tocar lógica.
- **SVG generado por JS**: mover un nodo es cambiar un par de números en el JSON.
- **Colores espejados del drawio original**: quien vio el .drawio reconoce el mapa al toque.
- **Narrativa con callouts dirigidos por rol** (`<strong>Para arquitectos:</strong>`,
  `<strong>Para los líderes:</strong>`): cada audiencia encuentra su anclaje.
- **Sin build step**: cualquier persona del equipo puede editar los JSON sin instalar nada.
