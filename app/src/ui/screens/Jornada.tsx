/**
 * Pasar la jornada desde las fotografías.
 *
 * El trabajo lento no es el terreno: es llegar a la casa, ordenar las fotos por
 * día, después por punto, y recién ahí transcribir. Como cada foto trae en su
 * EXIF dónde y cuándo se tomó, ese ordenamiento lo hace la app.
 *
 * Nada se guarda sin revisión: la app agrupa y propone, la persona confirma.
 */
import { useMemo, useState } from 'react';
import { attachMedia } from '../../db/repository';
import { analyzeJourney, summarize, type JourneyGroup, type JourneyPhoto } from '../../media/journey';
import { preparePhoto } from '../../media/photo';
import { useStore } from '../../state/store';

export function Jornada() {
  const s = useStore();
  const [groups, setGroups] = useState<JourneyGroup[] | null>(null);
  const [files, setFiles] = useState<Map<string, File>>(new Map());
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const stations = useMemo(
    () => s.stations.filter((st) => st.projectId === s.projectId),
    [s.stations, s.projectId],
  );
  const summary = groups ? summarize(groups) : null;

  async function read(selected: FileList | null) {
    if (!selected?.length) return;
    setBusy(true);
    try {
      const list = [...selected].filter((f) => /\.(jpe?g|png|heic)$/i.test(f.name));
      const inputs = await Promise.all(list.map(async (f) => ({ fileName: f.name, buffer: await f.arrayBuffer() })));
      setFiles(new Map(list.map((f) => [f.name, f])));
      setGroups(analyzeJourney(inputs, stations));
    } finally {
      setBusy(false);
    }
  }

  /** Guarda las fotos de un punto, asociadas a la estación que dice el GPS. */
  async function importGroup(group: JourneyGroup) {
    if (!group.station) { s.notify('Ese grupo no tiene estación asignada.', 'warn'); return; }
    setBusy(true);
    try {
      let saved = 0;
      for (const photo of group.photos) {
        const file = files.get(photo.fileName);
        if (!file) continue;
        const prepared = await preparePhoto(file);
        await attachMedia({
          occurrenceId: null, eventId: null, kind: 'foto',
          mimeType: prepared.blob.type || 'image/jpeg', blob: prepared.blob,
          capturedAt: photo.takenAt ?? new Date().toISOString(),
          fix: photo.fix, headingDegrees: photo.metadata.headingDegrees,
          exif: {
            ...(photo.metadata as unknown as Record<string, unknown>),
            proterrRol: photo.role, proterrCardinal: photo.cardinal,
            proterrEstacion: group.station.stationCode,
          },
          fileName: photo.fileName,
        }, s.session);
        saved++;
      }
      s.notify(`${saved} foto(s) de ${group.station.stationCode} guardadas.`);
      setGroups((prev) => prev?.filter((g) => g !== group) ?? null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2>Pasar la jornada</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Selecciona todas las fotos del día. La app las ordena por punto usando el GPS
          de cada una, separa las de orientación de las de especies y avisa si alguna
          quedó con la etiqueta del punto anterior.
        </p>
        <input type="file" accept="image/*" multiple
          onChange={(e) => void read(e.target.files)} disabled={busy} />
        {busy && <p className="muted">Leyendo fotos…</p>}
        {stations.length === 0 && (
          <p className="chip warn">Carga primero las estaciones del proyecto (Ajustes).</p>
        )}
      </section>

      {summary && (
        <section className="card">
          <h2>Resumen</h2>
          <div className="stat">
            <div><b>{summary.days}</b><span>Días</span></div>
            <div><b>{summary.stations}</b><span>Puntos</span></div>
            <div><b>{summary.photos}</b><span>Fotos</span></div>
          </div>
          {summary.mislabelled > 0 && (
            <p className="chip error" style={{ marginTop: 10 }}>
              {summary.mislabelled} foto(s) con la etiqueta de otro punto
            </p>
          )}
          {summary.unassigned > 0 && (
            <p className="chip warn">{summary.unassigned} foto(s) lejos de toda estación conocida</p>
          )}
          {summary.withoutGps > 0 && (
            <p className="chip warn">{summary.withoutGps} foto(s) sin GPS: hay que asignarlas a mano</p>
          )}
        </section>
      )}

      {groups?.map((group, i) => {
        const key = `${group.date}|${group.station?.id ?? i}`;
        const desfasadas = group.photos.filter((p) => p.labelCheck.status === 'desfasada');
        return (
          <section className="card" key={key}>
            <h2>
              {group.date} · {group.station?.stationCode ?? 'sin estación'}
              {' '}<span className="muted">({group.photos.length} fotos)</span>
            </h2>

            {desfasadas.length > 0 && (
              <div className="issue" data-severity="blocker">
                <p>
                  {desfasadas.length} foto(s) traen la etiqueta <b>
                    {desfasadas[0].labelCheck.status === 'desfasada' ? desfasadas[0].labelCheck.label : ''}
                  </b>, pero el GPS las sitúa en <b>{group.station?.stationCode}</b>.
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  Pasa cuando la cámara conserva el punto anterior. Se guardan según el GPS,
                  que es el dato que no se olvida de actualizar.
                </p>
              </div>
            )}

            <div className="row" style={{ marginBottom: 8 }}>
              <span className="chip">📐 {group.photos.filter((p) => p.role === 'orientacion').length} orientación</span>
              <span className="chip">🦎 {group.photos.filter((p) => p.role === 'especie').length} especies</span>
              {group.photos.some((p) => p.role === 'sin-clasificar') && (
                <span className="chip warn">
                  {group.photos.filter((p) => p.role === 'sin-clasificar').length} sin clasificar
                </span>
              )}
            </div>

            <button className="btn ghost" style={{ width: '100%' }}
              onClick={() => setOpen(open === key ? null : key)}>
              {open === key ? 'Ocultar fotos' : 'Ver fotos'}
            </button>

            {open === key && (
              <ul className="list" style={{ marginTop: 8 }}>
                {group.photos.map((photo) => (
                  <PhotoRow key={photo.fileName} photo={photo}
                    onRole={(role) => setGroups((prev) => prev?.map((g) => (g !== group ? g : {
                      ...g,
                      photos: g.photos.map((p) => (p === photo ? { ...p, role } : p)),
                    })) ?? null)} />
                ))}
              </ul>
            )}

            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" disabled={busy || !group.station}
                onClick={() => void importGroup(group)}>
                Guardar las fotos de {group.station?.stationCode ?? 'este grupo'}
              </button>
            </div>
          </section>
        );
      })}

      {groups && groups.length === 0 && (
        <section className="card"><p className="muted">Nada más que importar.</p></section>
      )}
    </>
  );
}

function PhotoRow({ photo, onRole }: { photo: JourneyPhoto; onRole: (role: JourneyPhoto['role']) => void }) {
  const label = photo.labelCheck;
  return (
    <li style={{ flexWrap: 'wrap' }}>
      <span className="time">{photo.takenAt?.slice(11, 16) ?? '—'}</span>
      <span className="name">
        {photo.fileName}
        <div className="muted" style={{ fontSize: 12 }}>
          {photo.cardinal ? `rumbo ${photo.cardinal}` : 'sin rumbo'}
          {photo.distanceMeters != null ? ` · a ${photo.distanceMeters} m del punto` : ''}
          {label.status === 'desfasada' && ` · etiqueta ${label.label} ✕`}
          {label.status === 'desconocida' && ` · etiqueta "${label.label}" desconocida`}
        </div>
      </span>
      <select value={photo.role} onChange={(e) => onRole(e.target.value as JourneyPhoto['role'])}
        style={{ minHeight: 40, maxWidth: 150 }}>
        <option value="orientacion">Orientación</option>
        <option value="especie">Especie</option>
        <option value="sin-clasificar">Sin clasificar</option>
      </select>
    </li>
  );
}
