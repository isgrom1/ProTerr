# ProTerr — registro de fauna en terreno

Aplicación móvil offline-first para registrar fauna hablando, pensada para líneas
base y estudios ambientales. Convierte la planilla Excel de referencia en una base
de datos normalizada y compatible con Darwin Core, sin perder la planilla como
formato de salida.

> «El usuario registra la observación; el sistema se encarga del resto.»

```
"LDB de fauna diaria, EMF01, chucao, 1 sonido"
        ↓
  Estación   EMF01        (+ proyecto, región, ambiente, ladera, coordenadas…)
  Especie    Chucao       (+ Scelorchilus rubecula, Aves, Passeriformes,
                             Rhinocryptidae, Scelorchilus, rubecula)
  Registro   Vocalización → Directo
  Abundancia 1
  Fecha/hora automáticas, con zona horaria y GPS
```

## Documentación

Empieza por el [punto de partida](docs/A-punto-de-partida.md): las demás
decisiones se explican desde ahí.

| | |
|---|---|
| [A. Punto de partida](docs/A-punto-de-partida.md) | Los 15 problemas recurrentes de la planilla como herramienta, y la decisión frente a cada uno |
| [B. Modelo de datos](docs/B-modelo-datos.md) | Estrella Darwin Core; cada hallazgo → una decisión |
| [C. Arquitectura](docs/C-arquitectura.md) | Módulos, PWA vs nativo, contrato del backend |
| [D. Flujo UX](docs/D-flujo-ux.md) | Hablar → confirmar → guardar |
| [E. Esquema Darwin Core](docs/E-darwin-core.md) | Mapeo completo y el problema de `basisOfRecord` |
| [F. Estrategia offline](docs/F-estrategia-offline.md) | Cola, reintentos, conflictos, cero pérdida |
| [G. Estrategia de voz](docs/G-estrategia-voz.md) | STT en el dispositivo, NLP por reglas y sus límites |
| [H. Validación](docs/H-validacion-recordatorios.md) | Perfiles configurables; no bloquear al usuario |
| [I. MVP y etapas](docs/I-mvp.md) | Qué está hecho, qué no, y por qué |
| [J. Aristas adicionales](docs/J-aristas-adicionales.md) | Nueve vacíos que el brief no cubría: esfuerzo, ausencias, conservación, respaldo |
| [K. Plantillas por consultora](docs/K-plantillas.md) | Cómo la app se adapta al formulario de cada organización |

## Procedencia de los datos

ProTerr **no incorpora la planilla, el catálogo ni el formato de ninguna
organización**. Todo lo que trae fue escrito para este proyecto:

| Qué | De dónde sale |
|---|---|
| Catálogo de especies de arranque | `data/catalogo/catalogo-base-chile.csv`, escrito para este proyecto. Nombre común, nombre científico y clasificación son hechos científicos de dominio público. ~156 especies chilenas de registro corriente: es un punto de partida, no una lista autoritativa. |
| Estaciones | `data/catalogo/estaciones-demo.csv`, **ficticias**. No corresponden a ningún proyecto ni ubicación real. |
| Formato de salida | `NATIVE_TEMPLATE`, propio. El de cada consultora lo aporta esa consultora subiendo su formulario. |
| Categorías de conservación | Se cargan desde la lista oficial del organismo competente. El archivo que se entrega es un **ejemplo** marcado como tal, que hay que reemplazar. |

Cada organización carga sus propios catálogos y su propio formulario. Ver
[K. Plantillas por consultora](docs/K-plantillas.md).

## Cómo ejecutarlo

```bash
cd app
npm install
npm test        # 183 pruebas
npm run dev     # http://localhost:5173
npm run build   # PWA instalable en dist/
```

Los catálogos de arranque (especies, estaciones de demostración y vocabularios) se siembran solos en
la primera apertura y quedan en IndexedDB. Después la app funciona sin conexión.

## Estructura

```
data/catalogo/              catálogo de especies y estaciones de demostración, propios
data/conservacion/          lista de conservación (el archivo entregado es un EJEMPLO)
tools/
  construir_catalogo.py     CSV propios → semillas JSON
  cargar_conservacion.py    lista oficial RCE → capa de conservación
app/src/
  domain/       tipos Darwin Core y borrador de observación
  effort/       track explícito, waypoints, abundancia relativa
  conservation/ categorías RCE/UICN, endemismo, movilidad, especies sensibles
  quality/      duplicados, vacíos de esfuerzo y tabla de especies
  db/           esquema Dexie, semillas, repositorio con auditoría
  nlp/          parser en español, léxico, números, comandos, índice taxonómico
  validation/   perfiles configurables + motor de recordatorios
  speech/       reconocimiento de voz del dispositivo
  geo/          UTM ↔ WGS84, sugerencia de estación
  sync/         cola, reintentos con espera creciente, conflictos
  export/       catálogo de campos · plantillas · CSV · Darwin Core Archive
  import/       detección de plantillas ajenas y de datos históricos
  state/        store (la verdad está en IndexedDB)
  ui/           5 pantallas de terreno
```

## Qué hace distinto a un formulario

- **No hay sintaxis obligatoria.** «Tres rayaditos, picaflor chico macho, una
  loica alimentándose» produce tres registros independientes; «dos tiuques
  volando hacia el norte, altura veinte metros» produce uno solo.
- **No bloquea.** Falta información ≠ no se puede guardar. Lo que falta queda
  registrado como pendiente, y se recuerda una vez.
- **No inventa.** «Fecas de puma» no es `Puma ×1`: es evidencia indirecta sin
  abundancia. «5 individuos, macho» pregunta a quién aplica el sexo.
- **No adivina.** Los 47 nombres comunes ambiguos del catálogo se preguntan en
  vez de resolverse con el primero de la lista, que es lo que hacía el
  `INDEX/MATCH` de la planilla.
- **No pide lo que puede derivar.** Proyecto, región, ambiente, coordenadas de
  estación y la taxonomía completa salen del catálogo, no del usuario.
- **La planilla es una salida, no la estructura.** Excel, CSV y Darwin Core
  Archive se generan desde el mismo modelo normalizado.
- **Se adapta al formulario de cada consultora.** Subes tu planilla, ProTerr
  reconoce sus columnas y exporta con esa forma exacta. No lleva incorporado el
  formato de nadie.
- **No estorba.** La jornada normal es «EMF01 y las especies, después EMF02 y
  más especies», sin abrir ni cerrar nada. Cada registro guarda su propia hora.
- **Mide el esfuerzo sólo si se lo pides.** «Iniciar track», «punto 100»,
  «cerrar track»: recién ahí el GPS graba y se calcula la abundancia relativa
  (ind/km, ind/100 trampas-noche). Sin eso, la app no reclama nada.
- **Pide GPS sólo donde importa.** Un ave en su estación no necesita punto
  propio; una lagartija, unas fecas o una especie amenazada sí, y la app dice
  por qué lo pide.
- **La ausencia también es un dato.** Una estación recorrida sin fauna se
  registra y se exporta como `occurrenceStatus=absent`.
- **Avisa de las especies amenazadas en terreno**, no en gabinete, y les exige
  fotografía y coordenada exacta. Nunca inventa una categoría: lo que no está
  en la lista oficial figura como «sin clasificar».
- **Protege las localidades sensibles** al exportar, con las tres políticas que
  Darwin Core prevé.
- **Tiene respaldo de verdad.** Un archivo con registros, esfuerzo, auditoría,
  cola y fotos, restaurable sin sobrescribir nada en silencio.
