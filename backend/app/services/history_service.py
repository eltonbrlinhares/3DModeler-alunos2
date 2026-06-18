"""Undo/redo por snapshot do modelo IFC (Fase 6).

Estratégia simples e robusta: antes de cada mutação, serializamos o modelo
inteiro (`file.to_string()`) e empilhamos. Undo restaura o snapshot anterior
recriando o `ifcopenshell.file` a partir da string.

Custo: O(n) por edição (serializa o modelo). Aceitável para modelos pequenos de
um editor interativo. Para modelos grandes, evoluir para diff de transações.
"""
from __future__ import annotations

import ifcopenshell

from app.services.ifc_service import ModelEntry

MAX_DEPTH = 50  # limita memória do histórico


def snapshot(entry: ModelEntry) -> None:
    """Empilha o estado atual no undo e limpa o redo. Chamar **antes** de mutar,
    com o lock do modelo já adquirido."""
    entry.undo_stack.append(entry.file.to_string())
    if len(entry.undo_stack) > MAX_DEPTH:
        entry.undo_stack.pop(0)
    entry.redo_stack.clear()


def undo(entry: ModelEntry) -> bool:
    with entry.lock:
        if not entry.undo_stack:
            return False
        entry.redo_stack.append(entry.file.to_string())
        entry.file = ifcopenshell.file.from_string(entry.undo_stack.pop())
        entry.dirty = True
        return True


def redo(entry: ModelEntry) -> bool:
    with entry.lock:
        if not entry.redo_stack:
            return False
        entry.undo_stack.append(entry.file.to_string())
        entry.file = ifcopenshell.file.from_string(entry.redo_stack.pop())
        entry.dirty = True
        return True


def depths(entry: ModelEntry) -> dict[str, int]:
    return {"undo": len(entry.undo_stack), "redo": len(entry.redo_stack)}
