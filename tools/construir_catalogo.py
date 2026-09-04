#!/usr/bin/env python3
"""Construye las semillas de ProTerr desde archivos CSV propios.

Uso:
    python3 tools/construir_catalogo.py                        # usa los archivos base
    python3 tools/construir_catalogo.py especies.csv estaciones.csv

Entradas (CSV, encabezados reconocidos sin acentos ni mayúsculas):
    especies:   nombre_comun, nombre_cientifico, clase, orden, familia
                (opcionales: reino, filo, genero, epiteto, subespecie,
                 nombres_alternativos separados por ";")
    estaciones: id_estacion, proyecto, region, temporada, ambiente, ladera,
                utm_este, utm_norte, y las banderas de metodología

Salidas (app/src/data/seed/): taxa.json, stations.json, vocabularies.json

ProTerr no incorpora el catálogo ni el formulario de ninguna organización: cada
una carga los suyos. Los archivos de data/catalogo/ son un punto de partida
propio para que la app funcione desde el primer día.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app/src/data/seed"
DEFAULT_SPECIES = ROOT / "data/catalogo/catalogo-base-chile.csv"
DEFAULT_STATIONS = ROOT / "data/catalogo/estaciones-demo.csv"

CLASS_MAP = {
    "aves": "Aves", "mamiferos": "Mammalia", "mammalia": "Mammalia",
    "reptiles": "Reptilia", "reptilia": "Reptilia",
    "anfibios": "Amphibia", "amphibia": "Amphibia",
}
CLASS_ES = {"Aves": "Aves", "Mammalia": "Mamíferos", "Reptilia": "Reptiles", "Amphibia": "Anfibios"}
GROUP_MAP = {"Aves": "aves", "Mammalia": "mamiferos", "Reptilia": "reptiles", "Amphibia": "anfibios"}

# Comodines de grupo: permiten registrar sin llegar a especie.
GROUP_PLACEHOLDERS = [
    ("Ave no identificada", "Aves", None, ["ave", "aves", "pajaro", "pajaros", "ave sp", "passeriforme"]),
    ("Rapaz no identificada", "Aves", None, ["rapaz", "rapaces", "ave rapaz"]),
    ("Mamífero no identificado", "Mammalia", None, ["mamifero", "mamiferos"]),
    ("Roedor no identificado", "Mammalia", "Rodentia", ["roedor", "roedores", "raton", "ratones", "ratoncito"]),
    ("Quiróptero no identificado", "Mammalia", "Chiroptera", ["murcielago", "murcielagos", "quiroptero"]),
    ("Reptil no identificado", "Reptilia", None, ["reptil", "reptiles"]),
    ("Lagartija no identificada", "Reptilia", "Squamata", ["lagartija", "lagartijas", "lagarto", "lagartos"]),
    ("Anfibio no identificado", "Amphibia", "Anura", ["anfibio", "anfibios", "sapo", "rana"]),
]

VOCABULARIES = {
    "method": ["Transecto", "Punto de conteo", "Playback aves", "Playback anfibios",
               "Cámara trampa", "Trampas Sherman", "Grabadora acústica",
               "Tránsito aéreo", "Atropello", "Registro oportunista", "Otro"],
    "recordType": ["Individuo", "Vocalización", "Huella", "Fecas", "Madriguera", "Cururera",
                   "Plumas", "Muda", "Huesos", "Nido", "Egagrópila", "Registro de audio", "Otro"],
    "behaviour": ["Alimentándose", "Bebiendo", "Cazando", "Corriendo", "Cortejo", "Descansando",
                  "Desplazándose", "Durmiendo", "En suelo", "Escondido", "Nadando", "Nidificando",
                  "Posado", "Termorregulando", "Vocalizando", "Volando", "Agrupación", "Otro"],
    "flightHeightCategory": ["1", "2", "3", "4", "5"],
    "flightDirection": ["N", "NE", "E", "SE", "S", "SO", "O", "NO", "Otro"],
    "slopeAspect": ["Norte", "Noreste", "Este", "Sureste", "Sur", "Suroeste", "Oeste", "Noroeste", "Plano", "Otro"],
    "lifeStage": ["Adulto", "Juvenil", "Cría", "Huevo/Larva", "Indeterminado"],
    "organismCondition": ["Vivo", "Muerto", "Herido", "Indeterminado"],
    "sex": ["Macho", "Hembra", "Indeterminado"],
    "weather": ["Despejado", "Parcial", "Nublado", "Llovizna", "Lluvia", "Neblina", "Viento"],
    "occurrenceEvidenceKind": ["Directo", "Indirecto"],
}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def stable_id(prefix: str, *parts: str) -> str:
    return f"{prefix}_{hashlib.sha1('|'.join(p or '' for p in parts).encode()).hexdigest()[:10]}"


def read_csv(path: Path) -> list[dict[str, str]]:
    lines = [l for l in path.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("#")]
    rows = list(csv.DictReader(lines))
    return [{fold(k): (v or "").strip() for k, v in row.items() if k} for row in rows]


def truthy(v: str) -> bool:
    return fold(v) in {"si", "s", "1", "true", "yes", "x"}


def build_taxa(rows: list[dict[str, str]]) -> list[dict]:
    taxa, by_name = [], {}
    for i, row in enumerate(rows):
        common = row.get("nombre comun", "")
        if not common:
            continue
        sci = row.get("nombre cientifico", "") or None
        parts = (sci or "").split()
        genus = row.get("genero") or (parts[0] if len(parts) >= 1 else None)
        epithet = row.get("epiteto") or (parts[1] if len(parts) >= 2 else None)
        infra = row.get("subespecie") or (parts[2] if len(parts) >= 3 else None)
        cls = CLASS_MAP.get(fold(row.get("clase", "")))

        # Una misma especie tiene varios nombres según la zona ("Rana chilena"
        # y "Rana grande chilena"). Son la MISMA especie: van como sinónimos,
        # no como dos taxones, para no inventar una ambigüedad que no existe.
        others = [n.strip() for n in re.split(r"[;|]", row.get("nombres alternativos", "")) if n.strip()]
        keys = {fold(common)} | {fold(n) for n in others}
        if sci:
            keys.add(fold(sci))
            if genus and epithet:
                keys.add(fold(f"{genus[0]}. {epithet}"))  # abreviatura "S. rubecula"
        taxa.append({
            "id": stable_id("tx", sci or common, str(i)),
            "sourceCommonName": common,
            "commonName": common,
            "otherCommonNames": others,
            "scientificName": sci, "scientificNameRaw": sci, "scientificNameNote": None,
            "kingdom": row.get("reino") or "Animalia",
            "phylum": row.get("filo") or "Chordata",
            "class": cls, "classEs": CLASS_ES.get(cls or "", row.get("clase") or None),
            "order": row.get("orden") or None,
            "family": row.get("familia") or None,
            "genus": genus, "specificEpithet": epithet, "infraspecificEpithet": infra,
            "taxonRank": "subspecies" if infra else "species" if epithet else "genus" if genus else "unranked",
            "group": GROUP_MAP.get(cls or "", "otros"),
            "isPlaceholder": False,
            "searchKeys": sorted(k for k in keys if k),
        })
        by_name.setdefault(fold(common), []).append(taxa[-1]["id"])

    for name, cls, order, aliases in GROUP_PLACEHOLDERS:
        taxa.append({
            "id": stable_id("tx", "placeholder", name),
            "sourceCommonName": name, "commonName": name, "otherCommonNames": [],
            "scientificName": None, "scientificNameRaw": None, "scientificNameNote": None,
            "kingdom": "Animalia", "phylum": "Chordata",
            "class": cls, "classEs": CLASS_ES[cls],
            "order": order, "family": None, "genus": None,
            "specificEpithet": None, "infraspecificEpithet": None,
            "taxonRank": "order" if order else "class",
            "group": GROUP_MAP[cls], "isPlaceholder": True,
            "searchKeys": sorted({fold(a) for a in aliases} | {fold(name)}),
        })

    # El nombre común repetido se marca: la app pregunta en vez de adivinar.
    ambiguous = {t for ids in by_name.values() if len(ids) > 1 for t in ids}
    for t in taxa:
        t["ambiguousCommonName"] = t["id"] in ambiguous
    return taxa


def build_stations(rows: list[dict[str, str]]) -> list[dict]:
    num = lambda v: float(v) if re.fullmatch(r"-?\d+(\.\d+)?", (v or "").replace(",", ".")) else None
    out = []
    for row in rows:
        code = row.get("id estacion", "")
        if not code:
            continue
        project = row.get("proyecto") or "Proyecto"
        out.append({
            "id": stable_id("st", project, code),
            "stationCode": code,
            "finalStationCode": row.get("id final estacion") or code,
            "project": project,
            "region": row.get("region") or None,
            "season": row.get("temporada") or None,
            "habitat": row.get("ambiente") or None,
            "slopeAspect": row.get("ladera") or None,
            "utmEast": num(row.get("utm este", "")), "utmNorth": num(row.get("utm norte", "")),
            "utmStartEast": num(row.get("utm este inicio", "")), "utmStartNorth": num(row.get("utm norte inicio", "")),
            "utmEndEast": num(row.get("utm este fin", "")), "utmEndNorth": num(row.get("utm norte fin", "")),
            "methods": {
                "transecto": truthy(row.get("transecto", "")),
                "playback_aves": truthy(row.get("playback aves", "")),
                "playback_anfibios": truthy(row.get("playback anfibios", "")),
                "camara_trampa": truthy(row.get("camara trampa", "")),
                "trampa_sherman": truthy(row.get("trampa sherman", "")),
            },
            "recordedBy": row.get("muestreado por") or None,
            "identifiedBy": row.get("identificado por") or None,
            "playbackBirdPoints": [], "playbackAmphibianPoints": [],
            "cameraTraps": [], "shermanLines": [],
        })
    return out


def preserve_conservation(taxa: list[dict]) -> None:
    """Conserva la capa de conservación al regenerar el catálogo."""
    out = OUT / "taxa.json"
    if not out.exists():
        return
    try:
        previous = json.loads(out.read_text(encoding="utf8"))
    except (json.JSONDecodeError, OSError):
        return
    by_name = {(t.get("scientificName") or "").lower(): t["conservation"]
               for t in previous if t.get("conservation") and t.get("scientificName")}
    kept = 0
    for t in taxa:
        status = by_name.get((t.get("scientificName") or "").lower())
        if status:
            t["conservation"] = status
            kept += 1
    if kept:
        print(f"  capa de conservación conservada: {kept} taxones")


def main() -> int:
    species_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SPECIES
    stations_path = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_STATIONS
    OUT.mkdir(parents=True, exist_ok=True)

    taxa = build_taxa(read_csv(species_path))
    preserve_conservation(taxa)
    stations = build_stations(read_csv(stations_path))

    for name, payload in [("taxa", taxa), ("stations", stations), ("vocabularies", VOCABULARIES)]:
        f = OUT / f"{name}.json"
        f.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
        print(f"  {f.relative_to(ROOT)}: {len(payload)} entradas")

    print(f"\nespecies: {sum(1 for t in taxa if not t['isPlaceholder'])}"
          f" + {sum(1 for t in taxa if t['isPlaceholder'])} comodines de grupo")
    print(f"ambiguas: {sum(1 for t in taxa if t['ambiguousCommonName'])}")
    print(f"estaciones: {len(stations)} ({species_path.name} / {stations_path.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
