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

## J.11 Campos según el canal de detección

**El problema.** Se pedía comportamiento en una vocalización igual que en un
avistamiento. Si sólo lo oíste, no puedes decir qué hacía aparte de cantar ni si
era juvenil: pedirlo obliga a inventar o a ignorar el aviso.

**Lo implementado.** El tipo de registro dice por qué canal se detectó al
animal, y eso decide qué se puede saber de él:

| Tipo de registro | Conducta | Edad | Sexo |
|---|---|---|---|
| Individuo (visto) | recomendada | recomendada | opcional |
| Cámara trampa | recomendada | recomendada | opcional |
| Vocalización, audio | **oculta** | **oculta** | oculta |
| Evidencia indirecta | oculta | oculta | oculta |

Además, «vocalización» ahora llena la conducta igual que «cantando»: antes el
mismo hecho quedaba distinto según cómo se dijera.

## J.12 «¿Seguimos en esta estación?»

**El problema.** El error más caro de terreno: caminar a la siguiente estación y
seguir dictando con la anterior seleccionada. Una jornada mal asignada no se
recupera en gabinete.

**Lo implementado.** Si el GPS te sitúa a más de 200 m de la estación
seleccionada, la tarjeta de confirmación lo dice **antes de guardar** y ofrece
la más cercana:

```
┃ Estás a 445 m de EMF01. La más cercana es EMF02.
┃ [Cambiar a EMF02 (12 m)]  [Sigo en EMF01]
```

Nunca cambia solo, y calla cuando la precisión del GPS es peor que la distancia:
eso sería ruido del receptor, no un error del usuario.

## J.13 Deshacer, repetir y corregir

Tres cosas del ritmo de terreno, cada una con comando de voz **y** botón,
porque a veces no se puede hablar (viento, ruido, compañía) o el micrófono no
engancha:

| Acción | Voz | Toque |
|---|---|---|
| Deshacer el último guardado | «deshacer», «me equivoqué» | botón en el mismo aviso de guardado |
| Repetir el último registro | «otro igual», «otros 3 iguales» | «↺ Otro chucao» en la pantalla de terreno |
| Corregir el último | «corrige, eran dos», «no, era hembra» | abrir el registro |

La corrección hablada se reinterpreta con el mismo parser, apoyada en la especie
ya registrada, y confirma qué cambió: *«Corregido — abundancia: 3»*.
Deshacer usa borrado lógico: el registro queda en la auditoría.

## J.14 La fotografía llena el registro

**El hallazgo.** Las fotos de terreno tomadas con una app de marca de agua traen
en su EXIF mucho más de lo que se ve encima. Una foto real de campo contenía:

```
GPSLatitude/Longitude   coordenada exacta del avistamiento
GPSHPositioningError    precisión declarada por el equipo
GPSAltitude             altitud
GPSImgDirection         rumbo de la cámara
DateTimeOriginal        hora real de la toma
ImageDescription        "PMF17"  <- el código de estación
Orientation             3 = rotada 180 grados
```

**Lo implementado** (`app/src/media/`):

- **Lector de EXIF propio**, ~150 líneas sin dependencias: en terreno cada
  kilobyte del paquete cuenta y sólo hacen falta doce etiquetas.
- **La foto propone, el usuario confirma.** Estación, fecha, hora y coordenada
  se ofrecen en la tarjeta; nada se aplica solo. La estación sólo se propone si
  el código escrito en la cámara coincide con una del catálogo.
- **Coordenada convertida a UTM**, que es lo que pide la planilla. (El sello
  visible de estas apps suele mostrar MGRS, que no sirve para el informe.)
- **Compresión a 1600 px.** Una foto de teléfono pesa 5-6 MB; cien fotos de
  jornada son 600 MB en el dispositivo y un respaldo inmanejable. A 1600 px
  sigue sirviendo para verificar una identificación y pesa ~40 veces menos.
- **Orientación aplicada a los píxeles.** Al recomprimir se pierde el EXIF, así
  que la rotación hay que hornearla; si no, la foto se ve al revés.

Si el navegador no puede decodificar la imagen, se guarda tal cual: perder la
foto sería mucho peor que guardarla pesada.

## J.15 Las estaciones salen del KMZ del proyecto

**El problema.** El proyecto llega con un KMZ del cliente que ya trae todos los
puntos de muestreo. Cargarlos en la app significaba transcribir decenas de
coordenadas a mano.

**Lo implementado** (`app/src/geo/kml.ts`). Se carga el KML o el KMZ, se listan
los puntos y se eligen cuáles usar:

- **KMZ descomprimido sin dependencias**, con `DecompressionStream` sobre un
  lector de zip de unas 60 líneas: el KMZ es un zip con un solo archivo dentro y
  no vale la pena engordar el paquete que se descarga antes de salir a terreno.
- **Prefijo configurable**: los archivos suelen nombrar los puntos `PM01` y el
  equipo trabajar con `PMF01`.
- **Nombres repetidos marcados**: un KML de proyecto real suele traer algún
  punto duplicado; se avisa en vez de perder uno.
- **Transectos dibujados como línea** aportan además inicio, fin y longitud.
- Volver a cargar una estación existente **conserva su identificador**, y con eso
  los registros que ya la referencian.

## J.16 La etiqueta de la foto que quedó del punto anterior

**El problema, reportado desde terreno.** La app de cámara conserva la etiqueta
escrita para el punto anterior. Se termina en PMF40, se camina a PMF50, se saca
la primera foto —normalmente una de orientación— y sale rotulada PMF40. Sin
cruzarlo con nada, ese error viaja hasta el informe.

**Lo implementado.** La etiqueta se contrasta con el GPS de la propia foto:

| Situación | Qué hace |
|---|---|
| Etiqueta y GPS coinciden | la da por buena |
| Etiqueta a >200 m y hay otra estación más cerca | **avisa**: «traen la etiqueta PMF40, pero el GPS las sitúa en PMF50» |
| La foto no trae GPS | dice que no se puede verificar; no acusa a nadie |
| La etiqueta no es de este proyecto | la marca aparte |

**Manda el GPS**, porque es el dato que no se olvida de actualizar. La etiqueta
queda registrada igual, para poder auditar la discrepancia.

**Lo implementado después: que el rótulo lo escriba la app.** Detectar el error
es peor que no cometerlo. Si ProTerr pone el rótulo, no puede quedarse
atrasado: sale del registro, y el registro sabe en qué punto está porque el
consultor acaba de elegirlo y el GPS lo confirma.

La cámara vive dentro de la app (`media/camara.ts`, `ui/Camara.tsx`) y el visor
muestra el rótulo **antes** de disparar, con la misma función que lo dibuja al
exportar: si dice el punto equivocado, se ve cuando todavía se puede arreglar.

**El rótulo no se hornea en los píxeles** (`media/rotulo.ts`). La foto guardada
queda limpia y el rótulo se dibuja encima al mostrarla y al exportarla:

- Si el punto estaba mal y se corrige, el rótulo se corrige solo. Con el texto
  quemado en la imagen habría que volver a terreno.
- No se duplica el peso, y las fotos ya son lo más pesado del dispositivo.
- La foto original, sin retocar, sigue siendo la que respalda el informe.

Al exportar salen **las dos versiones**, que es lo que pidió terreno:
`fotos/rotuladas/` para el informe y `fotos/limpias/` por si el rótulo fallara.
El nombre del archivo también es dato —`EMF44_2026-09-04_1034_Chucao_1.jpg`—
así que la carpeta ordenada alfabéticamente queda ordenada por punto y por hora.

Qué dice el rótulo se elige sobre el mismo catálogo de campos de exportación: no
hay un vocabulario nuevo. Por defecto son las cinco líneas de una pizarra de
terreno —punto, fecha, hora, UTM y proyecto—; más no se leen en una foto y tapan
el sujeto.

**Dos costos de la cámara propia, dichos en voz alta.** La foto sale peor que
con la app del teléfono, que hace HDR y apilado de cuadros; y el cuadro nace en
un canvas, sin EXIF. La posición y la hora no se pierden —las pone la app, que
las tiene mejores— pero el rumbo sí, y el rumbo es lo que usa J.17 para separar
las tomas de orientación de las de especies, así que se intenta leer la brújula
del dispositivo. Por eso **la cámara propia no reemplaza a la del teléfono, se
suma**: sirve para lo que antes hacía la pizarra, y la nativa sigue disponible
para la foto de la especie, donde la calidad manda. El rótulo se dibuja igual
sobre las dos.

`getUserMedia` sólo existe en contexto seguro: en `localhost` funciona, contra
la IP del computador desde el celular no. Una razón más para publicar en HTTPS.

## J.17 Pasar la jornada de una vez

**El problema.** El trabajo lento no es el terreno: es llegar a la casa, ordenar
las fotos por día, después por punto de muestreo, y recién ahí transcribir la
planilla.

**Lo implementado** (pestaña **Jornada**). Se seleccionan todas las fotos del
día y la app hace ese ordenamiento con lo que las fotos ya traen:

```
   fotos del día
        ↓
   agrupadas por día y por punto     (según el GPS de cada foto)
        ↓
   orientación separada de especies  (según el rumbo de la cámara)
        ↓
   etiquetas desfasadas señaladas
        ↓
   se revisa y se guarda por punto
```

**Cómo separa la orientación de las especies.** En cada punto se toman primero
las tomas de orientación —una por cada rumbo que pida la consultora— y después
las de las especies. Se usa esa costumbre: las primeras fotos cuyos rumbos
apuntan a cuadrantes distintos son la orientación. Es una **propuesta**: cada
foto se puede reclasificar con un toque, y si los rumbos no cumplen el patrón
esperado la app prefiere dejarlas sin clasificar antes que clasificarlas mal.

El rumbo del EXIF da además el punto cardinal de cada toma (197° = Sur), así que
las cuatro quedan identificadas N/E/S/O sin escribir nada.

---

## J.18 Modelo de licencia (implementado)

Tres caminos, y el usuario elige cuál. **Ninguno de los tres retiene datos.**

### 1. El ciclo: 2 días gratis, 5 de pago

Se repite indefinidamente y arranca con el primer uso. **Los 2 gratis no se
acumulan**: son posicionales, no un saldo. Quien no sale a terreno en tres
semanas no vuelve con seis días guardados —vuelve con dos—. Por eso el código no
tiene contador de días gratis consumidos: la posición en el ciclo es toda la
información necesaria (`licence/ciclo.ts`).

**La jornada corre de 04:00 a 04:00, no de medianoche a medianoche.** El
monitoreo de tránsito aéreo nocturno se hace entre las 22:00 y las 02:00; con el
corte a medianoche la app se cerraría en mitad de un conteo, con el observador en
un cerro y sin señal para desbloquearla. A las 04:00 no hay nadie trabajando.

### 2. Liberar un día viendo videos

**40 minutos acumulados valen una jornada, sin tope.** Quien esté dispuesto a
mirar avisos puede usar ProTerr gratis para siempre. Es una decisión tomada, no
un descuido: la fricción de los cuarenta minutos ES el argumento de venta de la
suscripción. Al precio real del video recompensado en Chile —unos US$5 de eCPM—
tres minutos dejan $28 y un día de suscripción vale $380. El desbloqueo por
videos no es una línea de ingreso: es lo que evita que el consultor cierre la app
y vuelva al cuaderno en el día 4 de una campaña en Aysén.

Tres reglas de comportamiento, todas con prueba:

- **Los segundos sobrantes se guardan.** Diez minutos hoy y treinta mañana
  liberan el día igual. Sin esto el modelo sólo serviría para quien pueda
  sentarse cuarenta minutos seguidos.
- **Un día acreditado no se gasta solo.** Si se gastara al abrir, quien entra el
  domingo a mirar el resumen perdería un día de terreno sin enterarse. Se gasta
  al apretar el botón, y cubre la jornada completa: cerrar y volver a abrir no
  cobra de nuevo.
- **Se le muestra el tiempo total que lleva mirando avisos.** Es su tiempo y
  tiene derecho a saber cuánto gastó. Que además sea el mejor argumento para
  suscribirse es cierto y no lo hace menos honesto.

### 3. Suscripción

Abre todos los días, sin videos y sin aviso al abrir. Renovar antes de vencer
suma sobre lo que queda, no lo pisa. **Falta el cobro**: necesita servidor.

### Lo que el bloqueo NO hace

Se cierra **registrar especies nuevas**, y nada más. Leer, exportar y respaldar
están siempre disponibles: un dato de terreno que no se puede sacar es un dato
secuestrado. En la interfaz eso significa que sólo las pestañas Terreno y
Confirmar se reemplazan por la puerta; Registros, Jornada, Resumen y Ajustes
siguen intactas.

### La costura de publicidad, sin proveedor detrás

`licence/ads.ts` define `ProveedorAds` y hoy exporta `SIN_ADS`: **no hay red
conectada**. Es deliberado. Los eCPM que hacen viable este modelo —US$3 a US$5—
vienen de los SDK de AdMob, Unity o ironSource, y **ésos sólo existen dentro de
una app instalada desde la tienda**. ProTerr es una PWA: desde la web sólo se
puede mostrar display, que paga veinte veces menos (ver J.20).

Todo el resto del sistema funciona y está probado contra esa interfaz. El día que
exista el envoltorio nativo se escribe un `ProveedorAds` más y no se toca nada
más. Mientras tanto la pantalla lo dice en voz alta en vez de mostrar un botón
muerto, y el progreso que alguien acumule se guarda igual.

### El reloj atrasado se anota, no se castiga

Sin servidor esto es inevitablemente confiable-por-honor: quien quiera saltárselo
cambiando la fecha del teléfono, se lo salta. Pero un equipo viejo al que se le
agotó la batería también amanece con el reloj en 1970, y bloquear a esa persona
en terreno sería mucho peor que perder una licencia. Se registra el desajuste, se
le avisa —porque la hora de sus registros sale de ahí— y se resuelve el día que
exista servidor.

### Cobro

**PayPal, a la cuenta del autor.** Es lo disponible ahora y sirve para partir.
En Chile el retiro a cuenta bancaria funciona pero cuesta: entre comisión de
recepción y conversión de divisa se pierde cerca del 13 %. Para un cobro
recurrente en pesos conviene comparar más adelante con Flow, Mercado Pago o
Webpay, que cobran en moneda local y evitan la conversión.

### Lo que falta, y exige servidor

- **Cobrar.** No hay pasarela ni forma de activar una suscripción real.
- **Que la licencia no sea burlable.** Ver el reloj, arriba.
- **Separación estricta.** El servidor de licencias no puede ver ni un dato de
  terreno. Son datos de proyectos de terceros, y no tener servidor es hoy la
  garantía de eso.

## J.19 La categoría de conservación se consulta, no se guarda

La nómina del MMA **no viaja dentro de la app**. La razón es la fecha: a junio de
2026 van veinte procesos de clasificación, y una copia vieja dentro de la app se
convierte en una categoría equivocada dentro de un informe que va a la autoridad.
El catálogo de especies que trae ProTerr sale ahora sin ninguna categoría puesta.

**El sitio del MMA no permite que la app descargue el archivo sola.** Se comprobó:
`clasificacionespecies.mma.gob.cl` responde 200 pero sin cabecera
`Access-Control-Allow-Origin`, así que el navegador bloquea la descarga desde otro
origen. No es un problema de permisos ni de red: es política del servidor, y sólo
se resuelve con un proxy propio.

Por eso la carga es **a mano y en dos pasos**, en Ajustes: se baja el XLSX del
sitio del MMA y se carga en la app, que lo lee entero (~1.600 filas), resuelve los
duplicados y guarda el resultado con el nombre del archivo y la fecha, para poder
citarlo en el informe.

Queda además un **servicio de consulta opcional** que recibe `?nombre=<binomio>` y
responde JSON con `categoria` y, si los tiene, `origen`, `endemica`, `fuente` y
`fechaFuente`. Sirve cuando exista un servidor propio que haga de proxy del MMA.
El orden de consulta es: nómina cargada → servicio → lo ya consultado.

### Tres rarezas del archivo oficial que hay que respetar

1. **Una especie puede aparecer dos veces**, una por cada proceso de clasificación
   en que se la revisó. Vale la del **proceso más alto**. A junio de 2026 son dos
   casos —*Aegla papudo* y *Sophora masafuerana*, ambas subidas a CR— y quedarse
   con la primera fila deja dos categorías atrasadas.
2. **La categoría no siempre es un código.** De 74 valores distintos, 92 especies
   traen categorías compuestas o regionales: «EN (JF); LC (Chile continental)».
   Se guardan tal cual. Reducirlas a un código sería inventar, porque la categoría
   de esa especie depende de dónde está.
3. **Hay entradas que no son especies válidas**, marcadas como «Nombre científico
   NO válido; sinonimia de…». Se conservan con esa nota: quien dictó ese nombre
   necesita ver que existe pero es sinónimo.

**Todo lo consultado se guarda.** Una especie ya preguntada responde después sin
señal, con la fecha de consulta a la vista, para que quien lea el informe sepa de
cuándo es el dato. Lo que nunca se consultó queda como **«sin consultar»**, que la
app distingue de **«sin categoría»**: la primera es ignorancia, la segunda es un
dato. Nunca se inventa una categoría.

El precio de esto es que la primera vez que se registra una especie hace falta
señal para ver su categoría en el punto. Es un precio aceptable porque el dato se
necesita sobre todo al entregar, no al observar.

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

## J.20 Qué formato de publicidad paga, y por qué no da igual

Cifras buscadas en septiembre de 2026. «Publicidad» no es una cosa: son seis, y
entre la peor y la mejor hay un factor de cien.

| Formato | eCPM Chile | 20 usuarios | 200 usuarios | Exige |
|---|---|---|---|---|
| Banner o display (AdSense) | US$0,50 | $570 | $5.700 | Nada |
| Aviso al abrir (app open) | US$1,50 | $1.710 | $17.100 | App en tiendas |
| Intersticial | US$3 | $3.420 | $34.200 | App en tiendas |
| Video recompensado | US$5 | $5.700 | $57.000 | App en tiendas + señal |
| Offerwall | US$400+ | descartado | descartado | — |
| Patrocinio directo | US$30–100 | no vendible | $150.000–300.000 | Vender a mano |

Cálculo a 2 aperturas por usuario al día, dólar a $950.

**El obstáculo estructural: ProTerr es una PWA.** Sólo la primera fila corre en
la web. El resto necesita empaquetar con Capacitor y publicar en las tiendas:
Google Play US$25 una vez, **Apple US$99 al año**. Con 20 usuarios el video
recompensado deja $68.400 al año y la cuenta de Apple sola cuesta $94.000: ir a
nativo sólo por publicidad no se paga hasta unos 30 usuarios.

**El offerwall se descarta por contexto, no por número.** Es el formato que más
paga —US$400 a US$530 de eCPM— pero ese eCPM es por *completar* ofertas:
instalar juegos, registrarse en pruebas gratis. Una app que entrega datos a la
autoridad ambiental con un muro que dice «instala este juego y gana 3 días»
pierde la credibilidad de la que depende todo lo demás.

**El patrocinio directo es el único que mueve la aguja.** Google no sabe que los
usuarios de ProTerr son *todos* biólogos de terreno chilenos; un distribuidor de
cámaras trampa sí. También compran laboratorios ambientales, diplomados en
manejo de vida silvestre y las propias consultoras reclutando terrenistas por
campaña. La contra es real: hay que llamar, mandar correo y emitir boleta, y por
debajo de unos 200 usuarios activos no hay nada que vender.

Consecuencia para el orden de trabajo: **debajo de 200 usuarios la publicidad no
es el tema**. Lo que paga antes de esa marca es la licencia a la consultora y la
suscripción individual, en ese orden.
