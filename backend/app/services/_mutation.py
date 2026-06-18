"""Context manager para mutações no modelo IFC.

Toda alteração do modelo segue o mesmo ritual: travar o `ModelEntry`, fazer um
snapshot para o undo **antes** de mutar e, ao final, marcar o modelo como sujo.
Encapsular isso aqui evita que cada função de serviço repita (e eventualmente
esqueça) esses passos.
"""
from __future__ import annotations

from contextlib import contextmanager

from app.services import history_service as hist
from app.services.ifc_service import ModelEntry


@contextmanager
def mutate(entry: ModelEntry):
    """Abre uma transação de edição e entrega o `ifcopenshell.file`.

    Uso:
        with mutate(entry) as f:
            ...altera f via ifcopenshell.api...

    Garante lock + snapshot (undo) + `entry.dirty = True` ao concluir.
    """
    with entry.lock:
        hist.snapshot(entry)
        yield entry.file
        entry.dirty = True
