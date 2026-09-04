#!/usr/bin/env python3
"""Carga la capa de conservación sobre el catálogo taxonómico.

Uso:
    python3 tools/cargar_conservacion.py [archivo.csv|archivo.xlsx]

El archivo debe traer una columna con el nombre científico y, opcionalmente:
rce, decreto, origen, endemica, migratoria, proteccion_legal, iucn, fuente.
Los nombres de columna se reconocen sin acentos ni mayúsculas, así que sirve
tal como lo exporta el Inventario Nacional de Especies del MMA.

Escribe `conservation` dentro de app/src/data/seed/taxa.json. La app NUNCA
inventa una categoría: lo que no venga en este archivo queda "sin clasificar",
que es distinto de "sin riesgo".
"""
from __future__ import annotations

import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TAXA = ROOT / "app/src/data/seed/taxa.json"
DEFAULT_INPUT = ROOT / "data/conservacion/EJEMPLO-rce.csv"

VALID_CATEGORIES = {"EX", "EW", "RE", "CR", "EN", "VU", "NT", "LC", "DD", "NE"}

# Sinónimos de encabezado, en forma plegada.
COLUMNS = {
    "scientificName": ["nombre cientifico", "nombre científico", "scientificname", "especie", "taxon"],
    "rce": ["rce", "categoria rce", "categoria", "clasificacion", "estado de conservacion"],
    "rceDecree": ["decreto", "ds", "norma"],
    "iucn": ["iucn", "uicn"],
    "origin": ["origen", "origin"],
    "endemic": ["endemica", "endemismo", "endemic"],
    "migratory": ["migratoria", "migratory", "migracion"],
    "legalProtection": ["proteccion legal", "proteccion", "ley"],
    "source": ["fuente", "source", "referencia"],
}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s).lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", s)).strip()


def truthy(v: str | None) -> bool | None:
    if v is None or str(v).strip() == "":
        return None
    return fold(v) in {"si", "s", "1", "true", "yes", "y", "x"}


def read_rows(path: Path) -> list[dict[str, str]]:
    if path.suffix.lower() in {".xlsx", ".xlsm", ".xlsb"}:
        import openpyxl
        ws = openpyxl.load_workbook(path, data_only=True).worksheets[0]
        rows = [[c.value for c in r] for r in ws.iter_rows()]
        header = [str(h or "") for h in rows[0]]
        return [dict(zip(header, [("" if v is None else str(v)) for v in r])) for r in rows[1:]]

    # Las líneas que empiezan con '#' son comentarios del archivo de ejemplo.
    lines = [l for l in path.read_text(encoding="utf8").splitlines() if not l.lstrip().startswith("#")]
    return list(csv.DictReader(lines))


def resolve_columns(fieldnames: list[str]) -> dict[str, str]:
    folded = {fold(f): f for f in fieldnames if f}
    mapping: dict[str, str] = {}
    for key, aliases in COLUMNS.items():
        for alias in aliases:
            if fold(alias) in folded:
                mapping[key] = folded[fold(alias)]
                break
    return mapping


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    if not path.exists():
        print(f"No existe {path}", file=sys.stderr)
        return 1
    if path == DEFAULT_INPUT:
        print("AVISO: estás cargando el archivo de EJEMPLO, no la lista oficial del MMA.\n")

    rows = read_rows(path)
    if not rows:
        print("El archivo no tiene filas.", file=sys.stderr)
        return 1

    cols = resolve_columns(list(rows[0].keys()))
    if "scientificName" not in cols:
        print(f"No se encontró la columna de nombre científico. Columnas vistas: {list(rows[0].keys())}", file=sys.stderr)
        return 1

    by_name: dict[str, dict] = {}
    warnings: list[str] = []
    for i, row in enumerate(rows, start=2):
        name = (row.get(cols["scientificName"]) or "").strip()
        if not name:
            continue
        get = lambda key: (row.get(cols[key]) or "").strip() if key in cols else ""
        rce = get("rce").upper() or None
        iucn = get("iucn").upper() or None
        for label, value in (("rce", rce), ("iucn", iucn)):
            if value and value not in VALID_CATEGORIES:
                warnings.append(f"fila {i}: categoría {label}='{value}' fuera del vocabulario; se descarta")
        status = {
            "rce": rce if rce in VALID_CATEGORIES else None,
            "rceDecree": get("rceDecree") or None,
            "iucn": iucn if iucn in VALID_CATEGORIES else None,
            "origin": get("origin") or None,
            "endemic": truthy(get("endemic")),
            "migratory": truthy(get("migratory")),
            "legalProtection": get("legalProtection") or None,
            "source": get("source") or path.name,
        }
        by_name[fold(name)] = {k: v for k, v in status.items() if v is not None}

    taxa = json.loads(TAXA.read_text(encoding="utf8"))
    matched = 0
    for t in taxa:
        sci = t.get("scientificName")
        status = by_name.get(fold(sci)) if sci else None
        if status:
            t["conservation"] = status
            matched += 1
        else:
            t.pop("conservation", None)

    TAXA.write_text(json.dumps(taxa, ensure_ascii=False, indent=1) + "\n", encoding="utf8")

    threatened = sum(1 for t in taxa if (t.get("conservation") or {}).get("rce") in {"CR", "EN", "VU", "EX", "EW", "RE"})
    unmatched = len(by_name) - matched
    print(f"  {len(by_name)} especies en el archivo")
    print(f"  {matched} calzaron con el catálogo ({matched / len(taxa) * 100:.1f}% de {len(taxa)} taxones)")
    print(f"  {threatened} quedan en categoría de amenaza")
    if unmatched > 0:
        print(f"  {unmatched} del archivo no existen en el catálogo (revisa la sinonimia)")
    for w in warnings[:10]:
        print(f"  aviso: {w}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
