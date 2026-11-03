# K. Plantillas por consultora

## K.1 El problema

Cada consultora entrega en su propio formulario, y ese formulario es suyo. Una
app que trae uno incorporado sirve a una sola organización y arrastra material
que no le pertenece.

## K.2 Cómo funciona

ProTerr tiene un modelo interno propio y un **catálogo de campos exportables**
(`app/src/export/fields.ts`): unos 90 datos con identificador estable, etiqueta y
los nombres con que se los suele llamar.

Una **plantilla** es sólo un mapeo:

```
hoja  →  encabezado de la planilla  →  identificador del campo
```

```
"FORMULARIO FAUNA" ─┬─ "Fecha"          → event.date
                    ├─ "PUNTO"          → station.code
                    ├─ "ESPECIE"        → occurrence.commonName
                    ├─ "N° individuos"  → occurrence.count
                    └─ "Código int. 47" → (sin asignar, sale vacía)
```

El exportador es genérico: no sabe de ningún formato, sólo recorre la plantilla.
Adaptarse a otra consultora es cargar su planilla, no tocar el código.

## K.3 Cargar el formulario de una consultora

`Ajustes → Formatos de exportación → Cargar el formulario de una consultora`.

1. **Detectar hojas.** Se descartan las de instrucciones, listas de validación y
   catálogos: no son formularios de registro.
2. **Encontrar el encabezado real.** Las planillas suelen traer logotipo,
   cliente y código de proyecto en las primeras filas. Se busca la fila con más
   textos distintos, no la primera con contenido.
3. **Proponer el mapeo.** Cada encabezado se compara con el catálogo de alias:
   coincidencia exacta, contenido, y por último diferencias menores de
   escritura.
4. **Revisar.** La app muestra cuántas columnas reconoció y cuáles no. Lo que no
   reconoce queda **sin asignar**, nunca adivinado: es preferible una columna
   vacía a una con el dato equivocado. El usuario empareja las que importen.
5. **Guardar.** Queda como plantilla elegible al exportar.

**El archivo subido no se guarda.** Se lee en memoria y se descarta; lo único
que queda es el mapeo, que es del usuario.

## K.4 Qué se conserva del formato original

- **Los encabezados exactos**, con su texto y su orden.
- **El preámbulo**: las filas decorativas sobre el encabezado se reproducen tal
  cual. Admiten marcadores que se rellenan al exportar: `{{cliente}}`,
  `{{proyecto}}`, `{{codigo}}`, `{{evaluador}}`, `{{fecha}}`, `{{huso}}`.
- **La separación en hojas.** Cada hoja declara qué alimenta:

| Alcance | Una fila por |
|---|---|
| `registros` | observación, sin las de tránsito aéreo |
| `transito_aereo` | observación de tránsito aéreo |
| `registros_todos` | observación, todas juntas |
| `muestreos` | evento, incluidos los que no tuvieron detecciones |
| `estaciones` | estación usada |

## K.5 Reconocimiento de encabezados

El mismo catálogo de alias resuelve nombres muy distintos para el mismo dato:

```
"Nombre común" · "ESPECIE" · "Nombre vulgar"        → occurrence.commonName
"Abundancia" · "N° de individuos" · "Cantidad"      → occurrence.count
"ID Estación" · "PUNTO" · "Sitio" · "Transecto"     → station.code
"Muestreado por" · "Observador" · "Evaluador"       → event.recordedBy
"Estado desarrollo" · "Edad" · "Clase etaria"       → occurrence.lifeStage
```

Y **no adivina** cuando no reconoce: `"Código interno 47"` queda sin asignar.

## K.6 La misma máquina lee planillas históricas

El importador de datos antiguos (`app/src/import/planilla.ts`) usa el mismo
reconocimiento. Una planilla que ProTerr sabe escribir, también la sabe leer, sin
tener su formato incorporado.

El flujo es el de siempre: detectar → validar → mostrar errores → importar sólo
lo válido. El archivo original nunca se modifica.

## K.5b Cuando la detección se equivoca, manda la persona

El emparejamiento automático es una propuesta, no una decisión. Antes de
guardar la plantilla, en Ajustes se puede corregir todo:

- **Qué fila es el encabezado.** Se ofrecen las primeras filas con su contenido
  ("Fila 1 — CONSULTORA Z", "Fila 3 — Fecha · ID Estación · Nombre común"). Al
  elegir otra, la planilla se vuelve a leer entera desde ahí; no se parcha el
  resultado, porque el emparejamiento tiene que corresponder a la fila elegida.
- **Qué hojas se usan.** Una hoja descartada se puede forzar, y una detectada
  se puede excluir.
- **Qué lleva cada hoja** (registros, trampeo, MTAN, plan, muestreos,
  estaciones), por si el alcance deducido no es el correcto.
- **Qué campo alimenta cada columna**, con **un ejemplo del dato real al lado
  del encabezado**. Es lo que permite decidir: «TIPO» no dice nada; «Tipo C ·
  Tipo B2» deja claro que es el tipo de estación y no el filo.

Y antes de guardar se avisa **qué campos de terreno no tienen columna** en esa
planilla. No es un error —cada consultora pide lo suyo— pero conviene saber que
esos datos se van a registrar y no van a salir en ese Excel. Quedan igual en el
respaldo y en la exportación Darwin Core.

## K.6b Lo que se aprendió leyendo planillas ajenas de verdad

Probado contra dos formularios reales de consultoras distintas (un formulario
de app de terreno con 18 columnas y una planilla de línea base con 6 hojas y
114 columnas):

- **La instrucción viene dentro del encabezado.** «UTM -E (no modificar)»,
  «ID. Estación de Muestreo (No modificar)». El emparejador prueba el
  encabezado tal cual y también sin lo que va entre paréntesis.
- **«Orden» es el orden de Linneo y también el correlativo de filas.** Si la
  columna trae puros números no se empareja con taxonomía: una columna vacía es
  mejor que el número de fila exportado como orden taxonómico.
- **Un encabezado corto dentro de un alias largo no es evidencia.** «TIPO»
  (tipo de estación) dejaba de coincidir con «tipo de registro» o con «filo»;
  ahora se exige que los dos textos se parezcan en largo, no sólo que uno
  contenga al otro.
- **Condición reproductiva ≠ estado del organismo.** Se separaron: confundirlas
  convertía «Hembra con crías» en «Vivo».
- **Campos que faltaban y sí aparecen en terreno**: sector o localidad dentro
  del proyecto, equipo o cuadrilla, etapa de vida, ID de técnica (el punto o
  línea dentro de la estación).

Resultado medido: el formulario de 18 columnas queda con **0 columnas sin
emparejar**; la planilla de 114, con 28 —y las que quedan son hojas de otra
cosa (cavidades, hallazgos) o preguntas de operación («¿se realizó?»,
«¿por qué no?») que ProTerr todavía no modela.

## K.7 El formato nativo

`NATIVE_TEMPLATE` es la plantilla que trae ProTerr, y es una plantilla más:
cinco hojas con encabezados propios que incluyen esfuerzo, conservación y
trazabilidad. Sirve mientras la organización no cargue el suyo, y de ejemplo de
cómo se arma una plantilla.

**Una hoja por metodología, no una hoja con todas las columnas.** Es como están
armadas las planillas de terreno, y por una razón práctica: el origen del vuelo
no existe en un transecto y la trampa no existe fuera del trampeo, así que
juntarlo todo deja columnas vacías en casi todas las filas.

| Hoja | Alcance (`scope`) | Qué lleva de más |
| --- | --- | --- |
| `Plan` | `plan` | Una fila por celda planificada, se haya hecho o no |
| `Registros` | `registros` | Todo lo que no tiene hoja propia |
| `Trampeo` | `trampeo` | Línea, n° de trampa, código del individuo, recaptura |
| `MTAN` | `transito_aereo_nocturno` | Bloque horario, referencia de altura, tipo de vuelo |
| `Tránsito aéreo` | `transito_aereo` | Origen, destino, dirección y altura de vuelo |
| `Muestreos` | `muestreos` | Una fila por evento, con esfuerzo |
| `Estaciones` | `estaciones` | Una fila por estación |

La hoja `Plan` es la grilla con que sale el equipo y vuelve marcada. Tiene tres
estados y son distintos: **realizado** (hay muestreo, con o sin detecciones),
**no realizado** (se intentó y no se pudo, con su motivo) y **pendiente** (celda
en blanco, todavía por hacer). Confundir el último con el segundo es lo que hace
que una campaña parezca peor de lo que fue.

El alcance `registros_todos` sigue existiendo para una plantilla ajena que sí
quiera una sola hoja con todo.

## El catálogo de especies también lo trae la consultora

El catálogo de arranque de ProTerr trae 257 especies escritas para este
proyecto. Es un punto de partida, no la fauna de Chile, y en terreno se nota al
primer bicho que no está: en Atacama se dictó «platero» y no existía.

Parchar el catálogo especie por especie no escala, y además es la pregunta
equivocada. **Cada consultora trabaja contra su lista autorizada**, y los
nombres de esa lista son los que su planilla espera: un registro con el nombre
común de otra lista no le sirve aunque la especie sea la misma.

Y la lista suele venir en el mismo archivo que el formulario, en otra hoja. El
importador (`import/catalogo.ts`) busca la hoja que tenga nombre común o
científico más taxonomía, y se queda con la que más especies tiene; las demás
hojas nombran especies en sus columnas, pero no son el listado.

Las columnas se reconocen con el **mismo** `guessField` de las plantillas, más
una tabla corta para lo que allá significa otra cosa: «Tipo», en una lista de
especies, es el filo —Chordata, Arthropoda—, no el tipo de registro.

Tres reglas:

- **El archivo no se guarda.** Se lee en memoria, se extrae el catálogo y se
  descarta, igual que con las plantillas.
- **No se inventa taxonomía.** Lo que la lista no diga queda vacío, y el guión
  con que las planillas escriben los vacíos se trata como vacío, no como dato.
- **No se borra lo que ya había.** Se fusiona por nombre científico, y una
  especie que ya tenía registros **conserva su identificador**: cambiarlo
  dejaría huérfanos los registros que la referencian.

Un nombre común que aparece en dos especies queda marcado como ambiguo, para
que la app pregunte en vez de elegir la primera —que es justo lo que hacía el
`INDEX/MATCH` de la planilla.

Probado con una lista real de 889 filas: 872 especies, 460 aves, 193 mamíferos,
152 reptiles, 65 anfibios, 27 nombres comunes ambiguos.

## Cómo se revisa una planilla sin abandonar a la mitad

**El problema, reportado dos veces desde terreno.** «Esa parte es muy larga»,
y después de un primer arreglo, «sigue siendo engorroso». Una planilla real
trae 133 columnas: mostrarlas todas convierte un trámite de diez segundos en
diez minutos de scroll en un teléfono.

Lo que hacen los importadores de planillas que no se abandonan —Flatfile,
CSVbox, Dromo, OneSchema— converge en tres reglas:

1. **Confianza por tramos.** Los calces seguros se aplican solos; los medios se
   confirman; los bajos nunca se aplican en silencio, porque un mapeo
   equivocado corrompe el dato sin avisar.
2. **El mapeo aparece sólo si hay algo que arreglar.** El camino feliz es un
   botón.
3. **Valores de ejemplo al lado de cada columna.** «TIPO» no dice nada; «Tipo C»
   se decide en un segundo.

Las tres estaban a medias y ahora están completas. La que faltaba de verdad es
la segunda: el detalle vive detrás de «Revisar hoja por hoja».

**Y una cuarta, propia de esta planilla.** «No sé qué es» y «va vacía a
propósito» no son lo mismo, y pintarlas igual convertía cuatro decisiones ya
tomadas en cuatro alarmas:

- El **correlativo de fila** —«N», «N°»— no es un dato, es la numeración. Se
  omite, pero sólo si además trae números: una columna llamada «N» con códigos
  sí se pregunta.
- Lo que la planilla **declara autocompletado** —«(NO LLENAR)», «(no
  modificar)»— se omite. La guía de uso de la planilla lo dice: esas columnas
  se llenan solas con fórmulas.

Con la planilla real eso baja la revisión de **5 columnas sin asignar y 27 por
mirar a una sola duda** en 133 columnas.

**El catálogo viaja en el mismo archivo.** La planilla que se sube para
aprender su formato trae, en otra hoja, la lista de especies de la consultora.
Pedirla aparte era hacer subir el mismo archivo dos veces para dos cosas que
vienen juntas: ahora es una casilla en la misma pantalla.
