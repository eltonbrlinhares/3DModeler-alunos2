"""Edição de dados do modelo: atributos, property sets e remoção de produtos.

Mantém as mutações IFC fora das rotas (que viram tradução HTTP). Como toda
mutação, usam `with mutate(entry) as f:` para lock + undo + dirty. `by_guid`
levanta `RuntimeError` para guid inexistente — a rota traduz isso em 404.
"""
from __future__ import annotations

from typing import Any

import ifcopenshell.api

from app.services._mutation import mutate
from app.services.ifc_service import ModelEntry


def edit_attributes(entry: ModelEntry, guid: str, attributes: dict[str, Any]) -> None:
    with mutate(entry) as f:
        inst = f.by_guid(guid)
        ifcopenshell.api.run(
            "attribute.edit_attributes", f, product=inst, attributes=attributes
        )


def edit_pset(
    entry: ModelEntry, guid: str, pset_name: str, properties: dict[str, Any]
) -> None:
    with mutate(entry) as f:
        inst = f.by_guid(guid)
        pset = ifcopenshell.api.run(
            "pset.add_pset", f, product=inst, name=pset_name
        )
        ifcopenshell.api.run(
            "pset.edit_pset", f, pset=pset, properties=properties
        )


def delete_product(entry: ModelEntry, guid: str) -> None:
    with mutate(entry) as f:
        inst = f.by_guid(guid)
        ifcopenshell.api.run("root.remove_product", f, product=inst)
