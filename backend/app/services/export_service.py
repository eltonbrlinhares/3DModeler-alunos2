"""Exportação de modelos IFC para glTF binário (.glb) — Fase 7.

Usa o serializador glTF nativo do IfcOpenShell (sem dependências extras). O
objeto serializador só descarrega o arquivo ao ser destruído, então o
removemos explicitamente antes de devolver o caminho.
"""
from __future__ import annotations

import multiprocessing

import ifcopenshell.geom

from app.config import STORAGE_DIR
from app.services.ifc_service import ModelEntry


def export_glb(entry: ModelEntry) -> str:
    """Serializa o modelo para `storage/{id}.glb` e devolve o caminho."""
    out = STORAGE_DIR / f"{entry.model_id}.glb"

    settings = ifcopenshell.geom.settings()
    settings.set("use-world-coords", True)
    ser_settings = ifcopenshell.geom.serializer_settings()

    with entry.lock:
        serializer = ifcopenshell.geom.serializers.gltf(
            str(out), settings, ser_settings
        )
        serializer.setFile(entry.file)
        serializer.setUnitNameAndMagnitude("METER", 1.0)
        serializer.writeHeader()

        iterator = ifcopenshell.geom.iterator(
            settings, entry.file, multiprocessing.cpu_count()
        )
        if iterator.initialize():
            while True:
                serializer.write(iterator.get())
                if not iterator.next():
                    break
        serializer.finalize()
        del serializer  # força o flush/close do arquivo

    return str(out)
