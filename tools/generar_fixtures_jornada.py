#!/usr/bin/env python3
"""Genera las fotos de prueba para la importación de una jornada.

Reproduce el caso real que reporta el equipo de terreno: la app de cámara
conserva la etiqueta del punto anterior, así que las primeras fotos de una
estación salen con el código de la que se acaba de dejar.

Todas las coordenadas son de DEMOSTRACIÓN. No se usa ninguna foto real de
campo: llevaría la ubicación exacta de un proyecto.

Uso:  python3 tools/generar_fixtures_jornada.py
"""
from pathlib import Path

import piexif
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "app/src/media/__fixtures__/jornada"

# Estaciones de demostración (las mismas de data/catalogo/estaciones-demo.csv).
EMF01 = (-32.960000, -71.350000)
EMF02 = (-32.963627, -71.350000)  # ~400 m al sur de EMF01


def dms(value: float) -> tuple:
    """Grados decimales a la terna grados/minutos/segundos que usa el EXIF."""
    v = abs(value)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return ((d, 1), (m, 1), (int(round(s * 10000)), 10000))


def write(name: str, lat: float, lon: float, when: str, heading: float, label: str) -> None:
    exif = {
        "0th": {
            piexif.ImageIFD.ImageDescription: label.encode(),
            piexif.ImageIFD.Make: b"Demo",
            piexif.ImageIFD.Software: b"Timestamp Camera",
            piexif.ImageIFD.Orientation: 1,
            piexif.ImageIFD.DateTime: when.encode(),
        },
        "Exif": {piexif.ExifIFD.DateTimeOriginal: when.encode()},
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"S" if lat < 0 else b"N",
            piexif.GPSIFD.GPSLatitude: dms(lat),
            piexif.GPSIFD.GPSLongitudeRef: b"W" if lon < 0 else b"E",
            piexif.GPSIFD.GPSLongitude: dms(lon),
            piexif.GPSIFD.GPSHPositioningError: (900, 100),
            piexif.GPSIFD.GPSImgDirectionRef: b"T",
            piexif.GPSIFD.GPSImgDirection: (int(heading * 100), 100),
        },
        "1st": {},
        "thumbnail": None,
    }
    Image.new("RGB", (8, 6), (90, 120, 70)).save(
        OUT / name, "JPEG", exif=piexif.dump(exif), quality=50
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    lat1, lon1 = EMF01
    lat2, lon2 = EMF02

    # EMF01: cuatro tomas de orientación y una de especie, bien etiquetadas.
    for i, heading in enumerate([0.0, 90.0, 180.0, 270.0]):
        write(f"emf01-orient-{i}.jpg", lat1, lon1, f"2026:09:04 08:0{i}:00", heading, "EMF01")
    write("emf01-especie.jpg", lat1, lon1, "2026:09:04 08:12:00", 45.0, "EMF01")

    # EMF02: las mismas tomas, pero la cámara quedó con la etiqueta anterior.
    for i, heading in enumerate([0.0, 90.0, 180.0, 270.0]):
        write(f"emf02-orient-{i}.jpg", lat2, lon2, f"2026:09:04 09:0{i}:00", heading, "EMF01")
    write("emf02-especie.jpg", lat2, lon2, "2026:09:04 09:15:00", 200.0, "EMF02")

    total = len(list(OUT.glob("*.jpg")))
    print(f"  {total} fotos en {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
