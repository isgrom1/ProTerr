# C. Arquitectura

## C.1 Vista general

```
┌─────────────────────────── DISPOSITIVO (offline-first) ───────────────────────────┐
│                                                                                   │
│  UI Modo Terreno (React)                                                          │
│    Terreno · Confirmar · Registros · Resumen · Ajustes                            │
│         │                                                                         │
│         ▼                                                                         │
│  ┌────────────┐   ┌──────────────┐   ┌────────────────┐   ┌────────────────────┐  │
│  │ Voz / STT  │──►│ NLP español  │──►│ Validación     │   │ Catálogo taxonómico│  │
│  │ (en el     │   │ segmentador  │   │ perfiles       │◄──│ catálogo propio    │  │
│  │  aparato)  │   │ + léxico     │   │ configurables  │   │ índice de búsqueda │  │
│  └────────────┘   └──────────────┘   └────────────────┘   └────────────────────┘  │
│         │                 │                   │                     ▲             │
│         └─────────────────┴─────────┬─────────┘                     │             │
│                                     ▼                               │             │
│                         ┌───────────────────────┐                   │             │
│  ┌──────────┐           │  Repositorio          │───────────────────┘             │
│  │ GPS/UTM  │──────────►│  (auditoría + outbox) │                                 │
│  └──────────┘           └───────────┬───────────┘                                 │
│  ┌──────────┐                       ▼                                             │
│  │ Cámara   │──────────► ┌──────────────────────────┐                             │
│  └──────────┘            │  IndexedDB (Dexie)       │  ◄── fuente de verdad        │
│                          │  eventos, ocurrencias,   │      en terreno              │
│                          │  media, auditoría, cola  │                             │
│                          └───────────┬──────────────┘                             │
│                                      │                                            │
│         ┌────────────────────────────┼────────────────────────────┐               │
│         ▼                            ▼                            ▼               │
│  ┌─────────────┐          ┌────────────────────┐        ┌──────────────────┐      │
│  │ Exportador  │          │ Motor de           │        │ Importador       │      │
│  │ Excel/CSV/  │          │ sincronización     │        │ planillas        │      │
│  │ DwC-A       │          │ (reintentos+       │        │ históricas       │      │
│  └─────────────┘          │  conflictos)       │        └──────────────────┘      │
│                           └─────────┬──────────┘                                  │
└─────────────────────────────────────┼─────────────────────────────────────────────┘
                                      ▼  (cuando hay red, y sólo entonces)
                        ┌──────────────────────────────┐
                        │  Backend (fuera de esta       │
                        │  entrega): API de upsert      │
                        │  idempotente por UUID +       │
                        │  detección de conflictos      │
                        └──────────────────────────────┘
```

## C.2 Módulos y dónde están

| Módulo | Ubicación | Responsabilidad |
|---|---|---|
| Dominio | `app/src/domain/` | Tipos Darwin Core y borrador de observación |
| Base local | `app/src/db/` | Esquema Dexie, semillas, repositorio con auditoría |
| Catálogo taxonómico | `app/src/nlp/taxonIndex.ts` | Índice del catálogo, búsqueda tolerante |
| NLP | `app/src/nlp/` | Segmentación, léxico, números en español, comandos |
| Validación | `app/src/validation/` | Perfiles configurables + motor de recordatorios |
| Voz | `app/src/speech/` | Reconocedor del dispositivo, retroalimentación sonora |
| Geo | `app/src/geo/` | UTM ↔ WGS84, sugerencia de estación por cercanía |
| Esfuerzo | `app/src/effort/` | Track explícito, waypoints, abundancia relativa (opt-in) |
| Conservación | `app/src/conservation/` | Categorías RCE/UICN, endemismo, movilidad, especies sensibles |
| Calidad | `app/src/quality/` | Duplicados, vacíos de esfuerzo, tabla de especies |
| Respaldo | `app/src/db/backup.ts` | Copia y restauración completa de la base local |
| Sincronización | `app/src/sync/` | Cola, reintentos con espera creciente, conflictos |
| Exportación | `app/src/export/` | Catálogo de campos, plantillas por consultora, CSV, Darwin Core Archive |
| Importación | `app/src/import/` | Detección de plantillas ajenas y de datos históricos |
| Estado | `app/src/state/` | Store delgado; la verdad está en IndexedDB |
| UI | `app/src/ui/` | 5 pantallas optimizadas para terreno |
| Catálogos | `tools/` | CSV propios → semillas JSON, reproducible |

## C.3 Decisiones y por qué

**PWA (React + IndexedDB) en lugar de app nativa.**
Cubre todo lo que el brief exige: offline total, GPS, cámara, reconocimiento de
voz del sistema, almacenamiento local. Se instala desde un enlace, sin tienda de
aplicaciones, y se actualiza sin que nadie reinstale nada — relevante para un
equipo que sale a terreno mañana. **Costo real**: en iOS el reconocimiento de voz
web es menos fiable que el nativo, y el almacenamiento puede ser desalojado si el
dispositivo queda sin espacio. Si eso pesa más que la velocidad de despliegue, el
camino de migración es React Native reutilizando `domain/`, `nlp/`, `validation/`,
`geo/`, `export/` e `import/` sin cambios: no dependen del DOM. Sólo `ui/`,
`db/db.ts` (Dexie → SQLite) y `speech/` son específicos de la plataforma.

**IndexedDB como fuente de verdad, no como caché.**
El registro se escribe local **antes** de existir en cualquier servidor. La red
nunca participa del guardado. Es lo que hace que el brief §28 sea cierto y no una
aspiración.

**Reconocimiento de voz en el dispositivo, no en la nube.**
En terreno no hay red, así que un STT remoto no es una opción, es un bloqueo.
Además evita subir audio de campo a un tercero. Ver [G](G-estrategia-voz.md).

**NLP por reglas, no por modelo de lenguaje.**
Ver [G](G-estrategia-voz.md) §G.3 para la justificación completa y sus límites.

**Perfiles de requisitos como datos.**
Un perfil es JSON con `fields` + `overridesByMethod` + `overridesByRecordType`.
Cambiar qué se pide en tránsito aéreo no requiere tocar código (brief §8).

**Backend deliberadamente fuera de alcance.**
La app funciona completa sin él. El contrato que necesita es mínimo y está
declarado en `SyncTransport`: un `PUT /<entidad>/<uuid>` idempotente que
devuelva `409` con la versión remota cuando haya conflicto. Cualquier
implementación que cumpla eso sirve.

## C.4 Escalabilidad

- **Multi-proyecto / multi-campaña**: desde el modelo, no como agregado. La
  planilla asumía un proyecto por archivo.
- **Nuevos grupos taxonómicos** (quirópteros, entomofauna): sólo agregar filas al
  catálogo. `Taxon.group` ya distingue aves/mamíferos/reptiles/anfibios/otros.
- **Nuevas metodologías** (colisiones, electrocución, rescate, atropellos):
  agregar el código a `MethodCode` y su perfil de requisitos. Los campos
  específicos de cada metodología no ensucian el esquema porque viajan como
  `MeasurementOrFact`, que es el mecanismo que Darwin Core prevé para esto.
- **Volumen**: IndexedDB soporta cientos de miles de registros; el índice
  `*searchKeys` es multiEntry, así que la búsqueda de especie no recorre la tabla.
