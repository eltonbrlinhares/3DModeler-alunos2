"""In-process IFC model registry and core operations.

Models são mantidos em memória (dict) durante a vida do processo. Persistência
em disco fica em `storage/{model_id}.ifc`.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from threading import RLock
from typing import Any

import ifcopenshell
import ifcopenshell.api
import ifcopenshell.util.element

from app.config import IFC_SCHEMA, STORAGE_DIR


@dataclass
class ModelEntry:
    model_id: str
    file: ifcopenshell.file
    name: str
    dirty: bool = False
    lock: RLock = field(default_factory=RLock)
    # histórico para undo/redo (snapshots IFC serializados)
    undo_stack: list[str] = field(default_factory=list)
    redo_stack: list[str] = field(default_factory=list)

    @property
    def path(self):
        return STORAGE_DIR / f"{self.model_id}.ifc"


class IfcRegistry:
    def __init__(self):
        self._models: dict[str, ModelEntry] = {}
        self._lock = RLock()

    # ---------- lifecycle ----------
    def create_blank(self, name: str = "untitled") -> ModelEntry:
        f = ifcopenshell.api.run("project.create_file", version=IFC_SCHEMA)
        ifcopenshell.api.run(
            "root.create_entity", f, ifc_class="IfcProject", name=name
        )
        # unidades SI básicas
        ifcopenshell.api.run("unit.assign_unit", f)
        return self._register(f, name)

    def load_bytes(self, data: bytes, name: str) -> ModelEntry:
        # ifcopenshell precisa de path; salvamos antes de abrir
        tmp_id = uuid.uuid4().hex
        tmp_path = STORAGE_DIR / f"{tmp_id}.ifc"
        tmp_path.write_bytes(data)
        f = ifcopenshell.open(str(tmp_path))
        entry = self._register(f, name, model_id=tmp_id)
        return entry

    def _register(
        self, f: ifcopenshell.file, name: str, model_id: str | None = None
    ) -> ModelEntry:
        mid = model_id or uuid.uuid4().hex
        entry = ModelEntry(model_id=mid, file=f, name=name)
        with self._lock:
            self._models[mid] = entry
        return entry

    def get(self, model_id: str) -> ModelEntry:
        with self._lock:
            entry = self._models.get(model_id)
        if entry is None:
            raise KeyError(f"model_id desconhecido: {model_id}")
        return entry

    def list_models(self) -> list[dict]:
        with self._lock:
            return [
                {"model_id": m.model_id, "name": m.name, "dirty": m.dirty}
                for m in self._models.values()
            ]

    def save(self, model_id: str) -> str:
        entry = self.get(model_id)
        with entry.lock:
            entry.file.write(str(entry.path))
            entry.dirty = False
        return str(entry.path)

    def close(self, model_id: str) -> None:
        with self._lock:
            self._models.pop(model_id, None)

    # ---------- queries ----------
    def summary(self, model_id: str) -> dict[str, Any]:
        entry = self.get(model_id)
        f = entry.file
        counts: dict[str, int] = {}
        for inst in f:
            counts[inst.is_a()] = counts.get(inst.is_a(), 0) + 1
        project = f.by_type("IfcProject")
        return {
            "model_id": model_id,
            "name": entry.name,
            "schema": f.schema,
            "dirty": entry.dirty,
            "total_entities": len(list(f)),
            "project": project[0].Name if project else None,
            "type_counts": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        }

    def list_entities(self, model_id: str, ifc_type: str) -> list[dict]:
        f = self.get(model_id).file
        out = []
        for inst in f.by_type(ifc_type):
            out.append(
                {
                    "id": inst.id(),
                    "guid": getattr(inst, "GlobalId", None),
                    "type": inst.is_a(),
                    "name": getattr(inst, "Name", None),
                }
            )
        return out

    def entity_detail(self, model_id: str, guid: str) -> dict:
        f = self.get(model_id).file
        inst = f.by_guid(guid)
        info = inst.get_info(recursive=False)
        psets = ifcopenshell.util.element.get_psets(inst)
        return {
            "id": inst.id(),
            "guid": guid,
            "type": inst.is_a(),
            "attributes": {
                k: (v if not hasattr(v, "id") else v.id())
                for k, v in info.items()
            },
            "psets": psets,
        }


registry = IfcRegistry()
