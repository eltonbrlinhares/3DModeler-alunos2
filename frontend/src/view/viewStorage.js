import { reconcileViews } from "./viewModel.js";

const STORAGE_PREFIX = "3dmodeler:bim-views:";

export function loadViewState(modelId, levels = []) {
  if (!modelId || typeof localStorage === "undefined") {
    const views = reconcileViews([], levels);
    return { views, activeViewId: views[0]?.id ?? null };
  }
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${modelId}`);
    const parsed = raw ? JSON.parse(raw) : {};
    const views = reconcileViews(parsed.views ?? [], levels);
    const activeViewId = views.some((view) => view.id === parsed.activeViewId)
      ? parsed.activeViewId
      : views.find((view) => view.type === "3d")?.id ?? views[0]?.id ?? null;
    return { views, activeViewId };
  } catch (error) {
    console.warn("[Views] Falha ao restaurar as vistas salvas:", error);
    const views = reconcileViews([], levels);
    return { views, activeViewId: views[0]?.id ?? null };
  }
}

export function saveViewState(modelId, state) {
  if (!modelId || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${modelId}`, JSON.stringify(state));
  } catch (error) {
    console.warn("[Views] Falha ao salvar as vistas:", error);
  }
}
