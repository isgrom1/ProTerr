# J. Aristas que el brief no contemplaba

El brief cubre bien el **acto de registrar**. Al revisar el proyecto contra lo
que un informe de línea base necesita realmente, aparecieron nueve vacíos. Ocho
están implementados; el noveno está declarado y explicado más abajo.

Ninguno es un capricho técnico: cada uno es algo que, faltando, obliga a volver
a terreno o invalida un análisis.

---

## J.1 Esfuerzo de muestreo · opcional, nunca impuesto

**El problema.** «8 chucaos en EMF09» no es comparable entre campañas si no se
sabe cuánto se recorrió. La planilla no registraba esfuerzo en ninguna forma.

**El error que cometí primero.** Lo hice obligatorio. Eso rompe el uso real: en
terreno se dice «EMF44» y las especies, después «EMF55» y más especies, **sin
abrir ni cerrar nada**. Exigir que se cierre un muestreo en cada estación
convierte una herramienta rápida en un trámite, que es justo lo que el brief §12
pedía evitar.

**Cómo quedó.** El esfuerzo es una decisión explícita del usuario:

- **Registro rápido (por defecto).** Se nombra la estación y se dictan especies.
  No hay muestreo que abrir ni cerrar, no se mide duración ni distancia, y la
  app **no reclama nada**. Cada registro guarda su propia hora, que es lo único
  temporal que importa en este modo.
- **Track explícito (cuando hace falta).** Se dice «iniciar track». Recién ahí
  el GPS empieza a grabar y a contar tiempo. Ver [J.1b](#j1b-track-explícito).

`summarizeEffort()` devuelve `measured: false` cuando nadie pidió medir, y ni
la validación ni el panel de calidad dicen una palabra. Un registro rápido no es
un descuido: es el modo normal de trabajo.

Cuando sí se mide, el esfuerzo va a Darwin Core en `sampleSizeValue`,
`sampleSizeUnit` y `samplingEffort`, y al Excel en la hoja **Muestreos**.

| Metodología | Unidad de esfuerzo, si se mide |
|---|---|
| Transecto, registro oportunista | distancia recorrida |
| Cámara trampa, trampas Sherman | trampas × noches |
| Punto de conteo, playback, tránsito aéreo, songmeter | duración |

`relativeAbundance()` entrega la cifra comparable (`ind/km`,
`ind/100 trampas-noche`, `ind/h`) sólo cuando hay denominador.

## J.1b Track explícito

Cuatro comandos de voz, y nada ocurre sin ellos:

```
"iniciar track"    → abre el recorrido y marca el punto de inicio
"punto 100"        → marca un waypoint con ese nombre
"marcar punto 200" → ídem
"punto final"      → ídem  ("medio", "mitad", "fin" también se entienden)
"cerrar track"     → marca el punto final, congela distancia y duración
```

Los mismos botones están en pantalla para quien prefiera tocar.

**Los waypoints reemplazan al track completo.** Con inicio, 100, 200 y final se
reconstruye el transecto sin tener el GPS encendido todo el rato. Si además se
graba el recorrido punto a punto, se filtra antes de sumarlo: se descartan los
puntos con precisión peor que 30 m, la deriva del GPS cuando el usuario está
detenido, y los saltos a más de 5 m/s. Sin ese filtro, un GPS malo infla la
distancia en cientos de metros.

**La pantalla se mantiene encendida sólo con el track abierto.** Fuera de eso,
la batería importa más.

## J.2 Ausencias · una estación vacía es un dato

**El problema.** Si sólo se registran presencias, la campaña queda sesgada: no
se puede calcular ocupación ni detectar una disminución. «Recorrimos EMF12 y no
vimos nada» es información, y en la planilla simplemente no existía.

**Lo implementado.** El botón «Sin detecciones aquí» y el dictado «sin registros
en EMF09» marcan el evento con `noDetections`. Al exportar, GBIF lo espera como
una ocurrencia con `occurrenceStatus=absent` e `individualCount=0`, y así sale.
La hoja Muestreos también los lista.

## J.3 Confianza de la identificación

**El problema.** En terreno se dice «creo que era un chercán». Guardarlo como
chercán seguro es fabricar un dato, y es el error que más daño hace en una
línea base, porque nadie puede detectarlo después.

**Lo implementado.** El parser reconoce «creo que», «posible», «probablemente»,
«al parecer», «no estoy seguro». Se guarda como `seguro` / `probable` /
`posible` y se exporta en `dwc:identificationQualifier` con la convención
estándar: `cf.` para probable, `?` para posible, `sp.` para el comodín de grupo.
Una identificación dudosa sin fotografía aparece en el panel de calidad.

## J.4 Categoría de conservación · en terreno, no en gabinete

**El problema.** Encontrar una especie amenazada cambia el informe y puede
activar obligaciones legales. El técnico tiene que enterarse **en el momento del
registro**: si hay que tomar una foto o afinar la coordenada, es ahora o nunca.
Tres semanas después, en gabinete, ya no hay nada que hacer.

**Lo implementado** (`app/src/conservation/status.ts`):

- La tarjeta de confirmación muestra un distintivo destacado con la categoría
  (RCE o UICN), el decreto, el origen, el endemismo y la protección legal.
- Una especie amenazada **sube el listón automáticamente**: fotografía y
  coordenada del avistamiento pasan a obligatorias, por encima del perfil del
  proyecto.
- Las exóticas se marcan aunque no estén amenazadas: se informan por separado.

**Sobre los datos.** La app **nunca inventa una categoría**. Lo que no viene en
la lista cargada figura como «sin clasificar», que no es lo mismo que «sin
riesgo», y la app lo dice con esas palabras. Cada categoría se muestra **con su
fuente**, para que nadie confíe a ciegas.

El archivo que se entrega, `data/conservacion/EJEMPLO-rce.csv`, es
explícitamente **un ejemplo** para probar el mecanismo: 20 especies marcadas
«EJEMPLO - verificar con MMA». Antes de usar ProTerr en un proyecto real hay que
reemplazarlo por el Inventario Nacional de Especies del Ministerio del Medio
Ambiente y volver a ejecutar `python3 tools/cargar_conservacion.py <archivo>`.
El cargador acepta CSV o XLSX y reconoce los encabezados sin acentos ni
mayúsculas.

## J.5 Localidades sensibles al exportar

**El problema.** Publicar la coordenada exacta de un nido de cóndor o una
madriguera de especie amenazada facilita su saqueo. Es una preocupación
estándar y Darwin Core tiene términos para resolverla.

**Lo implementado** (`app/src/export/sensitive.ts`). Tres políticas al exportar:

| Política | Qué hace | Para qué |
|---|---|---|
| Exactas | nada | uso interno del proyecto |
| Generalizadas | redondea a ~1 km y llena `dataGeneralizations` | entrega a terceros |
| Omitidas | quita la coordenada y llena `informationWithheld` | publicación abierta |

Sólo afecta a especies amenazadas, y a las endémicas que además ya muestran
algún grado de riesgo. Un chucao es endémico y de preocupación menor: ocultar
dónde está sólo empobrece el dato, así que no se toca. **La base local y el
Excel interno conservan siempre la coordenada exacta**: el equipo necesita
volver al punto.

Antes de exportar, la pantalla dice cuántos registros se verían afectados.

## J.6 Respaldo local · el brief lo pedía y no estaba

**El problema.** El brief §28 pide «backup» explícitamente. La versión anterior
no tenía ninguno: un teléfono perdido o un IndexedDB desalojado por el sistema
se llevaba la campaña completa. La exportación a Excel no sirve de respaldo,
porque pierde la auditoría, la cola de sincronización, las fotos y los
identificadores.

**Lo implementado** (`app/src/db/backup.ts`). Un archivo JSON autocontenido con
registros, eventos, esfuerzo, auditoría, cola y fotos (como data URI, para que
no haya nada que adjuntar aparte en un cerro sin señal). La restauración tiene
dos modos:

- **Fusionar** (por defecto): añade lo que falta y, ante un choque, **conserva
  la versión local** y reporta el conflicto. Misma disciplina que la
  sincronización: nada se sobrescribe en silencio.
- **Reemplazar**: sobrescribe, porque el usuario lo pidió.

Rechaza archivos que no son respaldos y respaldos de una versión más nueva que
la app, en vez de leerlos a medias.

## J.7 Calidad del dato · lo que la planilla no podía ver

**El problema.** El doble guardado accidental pasa siempre (se toca «Guardar»
dos veces, o se vuelve a dictar la misma observación). En una planilla es
indetectable.

**Lo implementado** (`app/src/quality/report.ts`). Un panel en Resumen que
detecta:

| Hallazgo | Severidad |
|---|---|
| Mismo taxón, mismo evento, mismo tipo de registro, en menos de un minuto y **de dictados distintos** | alta |
| Especie amenazada sin fotografía | alta |
| Registro marcado «validado» que conserva campos pendientes | alta |
| Muestreo sin esfuerzo registrado | media |
| Identificación dudosa sin evidencia | media |
| Registro directo sin abundancia | media |

Más la tabla de especies con abundancia por taxón, marcando amenazadas y
exóticas, que es la primera tabla de cualquier informe.

## J.8 Revisión en gabinete

**El problema.** No había forma de distinguir un registro recién dictado bajo la
lluvia de uno ya revisado por el jefe de proyecto. Todos parecían igual de
firmes.

**Lo implementado.** Tres estados por registro: `terreno` → `revisado` →
`validado`, con quién y cuándo. Se ve en la lista de registros y viaja al Excel
y al `occurrenceRemarks` del DwC-A.

## J.9 GPS sólo donde la ubicación significa algo

**El problema.** Pedir un punto GPS por cada ave es trabajo inútil: el chucao ya
se movió, y el código de la estación lo ubica igual de bien. Pero una lagartija
bajo una piedra sí estaba justo ahí, y unas fecas de puma son un punto fijo en
el paisaje.

**Lo implementado** (`app/src/conservation/mobility.ts`). La coordenada propia
**no** se configura en el perfil: se decide por lo que se está registrando.

| Caso | ¿Punto propio? | Razón que muestra la app |
|---|---|---|
| Reptiles, anfibios | **sí** | especie de baja movilidad |
| Roedores y marsupiales | **sí** | especie de baja movilidad |
| Evidencia (fecas, huella, madriguera, nido, plumas, huesos) | **sí** | la evidencia queda en un punto fijo |
| Especie en categoría de conservación | **sí** | especie en categoría de conservación |
| Registro oportunista fuera de estación | **sí** | no hay estación que lo ubique |
| Aves, mamíferos grandes con registro directo | no | la estación ya lo ubica |

La misma regla decide cuándo **sugerir una fotografía**: especies amenazadas,
evidencia indirecta e identificaciones dudosas. Es lo que otro tendrá que
verificar; el resto no necesita foto.

El panel de calidad usa el mismo criterio: sólo echa de menos la coordenada
donde de verdad hacía falta.

## J.10 Otros detalles de terreno

- **Cada registro con su propia hora.** El usuario nombra la estación una vez y
  va dictando especies durante un rato. Antes todas heredaban la hora del
  muestreo; ahora cada una guarda la suya, que es la que va al Excel.
- **Comodines por grupo.** «Un ave no identificada», «una lagartija», «un
  roedor». El catálogo trae 8 comodines a nivel de clase
  u orden, para que esas observaciones no se pierdan.
- **Registro oportunista.** Fauna vista entre estaciones o en el campamento.
- **Distancia de detección.** «Un chucao a veinte metros», para *distance
  sampling*. Recomendada en punto de conteo, oculta en transecto.
- **Código del individuo y recaptura.** En trampeo, sin marca no hay recaptura.
- **Estación desconocida.** Si el dictado nombra un código que no está en el
  catálogo, se captura igual y se avisa. Antes se descartaba en silencio.
- **Prefijos libres de estación.** `EMF09`, `PMF44`, `TR-1`, `EP 3`: el patrón
  es letras + dígitos, con o sin separador.

---

## Lo que sigue faltando, y por qué

**Trabajo simultáneo de varias personas en la misma estación.** Hoy cada
dispositivo tiene su identidad y sus registros se fusionan por UUID sin
colisión, así que dos técnicos pueden trabajar en paralelo sin pisarse. Lo que
**no** existe es la noción de equipo: que ambos vean el mismo muestreo abierto y
compartan un único esfuerzo. Sin eso, si dos personas recorren juntas el mismo
transecto, la distancia se cuenta dos veces y la abundancia relativa queda a la
mitad.

No lo implementé porque **requiere el backend**, que está fuera del alcance
acordado: un esfuerzo compartido necesita un servidor que arbitre quién lo abre
y quién lo cierra, y resolverlo sólo en el dispositivo daría una respuesta
falsa. Mientras tanto, la regla de terreno es que **una sola persona abre el
muestreo** y las demás registran contra esa estación; el esfuerzo queda
correcto. Conviene dejarlo escrito en el protocolo del proyecto hasta que exista
el backend.
