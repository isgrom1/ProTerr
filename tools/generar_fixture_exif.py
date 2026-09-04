#!/usr/bin/env python3
"""Genera la fotografía de prueba para el lector de EXIF.

Es una imagen mínima con el EXIF que escriben las apps de cámara con marca de
agua que se usan en terreno: coordenada, altitud, precisión, rumbo, fecha y el
código de estación en la descripción.

Los valores son de DEMOSTRACIÓN. No se usa ninguna foto real de terreno: una
fotografía de campo lleva la coordenada exacta de un proyecto y no corresponde
guardarla en el repositorio.

Uso:  python3 tools/generar_fixture_exif.py
"""
from pathlib import Path

import piexif
from PIL import Image

OUT = Path(__file__).resolve().parents[1] / "app/src/media/__fixtures__/foto-demo.jpg"

# Estación de demostración EMF01: -32.960000, -71.350000
LAT_DMS = ((32, 1), (57, 1), (3600, 100))   # 32° 57' 36.00"
LON_DMS = ((71, 1), (21, 1), (0, 100))      # 71° 21' 00.00"


def main() -> None:
    exif = {
        "0th": {
            piexif.ImageIFD.ImageDescription: b"EMF01",
            piexif.ImageIFD.Make: b"Demo",
            piexif.ImageIFD.Model: b"Camara de terreno",
            piexif.ImageIFD.Software: b"Timestamp Camera",
            piexif.ImageIFD.Orientation: 3,          # rotada 180 grados
            piexif.ImageIFD.DateTime: b"2026:09:04 08:31:00",
        },
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: b"2026:09:04 08:31:00",
            piexif.ExifIFD.PixelXDimension: 4032,
            piexif.ExifIFD.PixelYDimension: 3024,
        },
        "GPS": {
            piexif.GPSIFD.GPSLatitudeRef: b"S",
            piexif.GPSIFD.GPSLatitude: LAT_DMS,
            piexif.GPSIFD.GPSLongitudeRef: b"W",
            piexif.GPSIFD.GPSLongitude: LON_DMS,
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (2385, 10),           # 238,5 m
            piexif.GPSIFD.GPSHPositioningError: (1200, 100),  # 12,0 m
            piexif.GPSIFD.GPSImgDirectionRef: b"T",
            piexif.GPSIFD.GPSImgDirection: (19716, 100),      # 197,16 grados
        },
        "1st": {},
        "thumbnail": None,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 6), (90, 120, 70)).save(OUT, "JPEG", exif=piexif.dump(exif), quality=60)
    print(f"  {OUT.relative_to(Path(__file__).resolve().parents[1])}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
