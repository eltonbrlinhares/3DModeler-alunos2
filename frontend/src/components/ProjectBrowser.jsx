import { useMemo, useState } from "react";
import { VIEW_TYPES } from "../view/viewModel.js";

const GROUPS = [
  [VIEW_TYPES.THREE_D, "Vistas 3D"],
  [VIEW_TYPES.PLAN, "Plantas estruturais"],
  [VIEW_TYPES.ELEVATION, "Elevações"],
  [VIEW_TYPES.SECTION, "Cortes"],
];

const CATEGORY_LABELS = {
  foundation: "Fundações",
  column: "Pilares",
  beam: "Vigas",
  slab: "Lajes",
  wall: "Paredes",
  grid: "Grids",
  level: "Níveis",
  dimension: "Cotas",
  generic: "Genéricos",
};

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ProjectBrowser({
  levels = [],
  views = [],
  activeViewId,
  activeLevelId,
  disabled = false,
  onOpenView,
  onSetActiveLevel,
  onRenameView,
  onDeleteView,
  onDuplicateView,
  onUpdateView,
  onCreateSection,
  onFitView,
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => new Set(GROUPS.map(([type]) => type).concat("levels")));
  const activeView = useMemo(
    () => views.find((view) => view.id === activeViewId) ?? null,
    [views, activeViewId],
  );

  const toggleGroup = (key) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const rename = (view) => {
    const name = window.prompt("Novo nome da vista:", view.name);
    if (name?.trim()) onRenameView?.(view.id, name.trim());
  };

  const remove = (view) => {
    if (view.type === VIEW_TYPES.THREE_D && views.filter((item) => item.type === VIEW_TYPES.THREE_D).length <= 1) {
      window.alert("A última vista 3D não pode ser excluída.");
      return;
    }
    if (window.confirm(`Excluir a vista “${view.name}”?`)) onDeleteView?.(view.id);
  };

  const patchActiveView = (patch) => {
    if (!activeView) return;
    onUpdateView?.(activeView.id, patch);
  };

  if (collapsed) {
    return (
      <button style={S.collapsedButton} onClick={() => setCollapsed(false)} title="Abrir Navegador do Projeto">
        ☰ Projeto
      </button>
    );
  }

  return (
    <aside style={S.panel} aria-label="Navegador do Projeto">
      <div style={S.header}>
        <strong>Navegador do Projeto</strong>
        <button style={S.iconButton} onClick={() => setCollapsed(true)} title="Recolher">−</button>
      </div>

      <div style={S.tree}>
        {GROUPS.map(([type, label]) => {
          const items = views.filter((view) => view.type === type);
          return (
            <div key={type}>
              <button style={S.groupButton} onClick={() => toggleGroup(type)}>
                <span>{openGroups.has(type) ? "▾" : "▸"}</span>
                <span>{label}</span>
                <span style={S.count}>{items.length}</span>
              </button>
              {openGroups.has(type) && (
                <div style={S.groupItems}>
                  {items.map((view) => (
                    <div
                      key={view.id}
                      style={{ ...S.item, ...(view.id === activeViewId ? S.activeItem : {}) }}
                      onDoubleClick={() => !disabled && onOpenView?.(view.id)}
                      title="Duplo clique para abrir"
                    >
                      <button
                        style={S.itemMain}
                        disabled={disabled}
                        onClick={() => onOpenView?.(view.id)}
                      >
                        {view.name}
                      </button>
                      <button style={S.miniButton} onClick={() => rename(view)} title="Renomear">✎</button>
                      <button style={S.miniButton} onClick={() => onDuplicateView?.(view.id)} title="Duplicar">⧉</button>
                      <button
                        style={{ ...S.miniButton, color: view.generated ? "#4b5563" : "#fca5a5" }}
                        onClick={() => remove(view)}
                        title={view.generated ? "Vista automática: duplique para editar/excluir" : "Excluir"}
                      >×</button>
                    </div>
                  ))}
                  {items.length === 0 && <div style={S.empty}>Nenhuma vista.</div>}
                  {type === VIEW_TYPES.SECTION && (
                    <button style={S.addButton} disabled={disabled} onClick={onCreateSection}>+ Novo corte</button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        <div>
          <button style={S.groupButton} onClick={() => toggleGroup("levels")}>
            <span>{openGroups.has("levels") ? "▾" : "▸"}</span>
            <span>Níveis</span>
            <span style={S.count}>{levels.length}</span>
          </button>
          {openGroups.has("levels") && (
            <div style={S.groupItems}>
              {levels.map((level) => {
                const id = level.guid ?? level.id;
                return (
                  <button
                    key={id}
                    style={{ ...S.levelItem, ...(id === activeLevelId ? S.activeLevel : {}) }}
                    disabled={disabled}
                    onClick={() => onSetActiveLevel?.(id)}
                    onDoubleClick={() => {
                      const plan = views.find((view) => view.type === VIEW_TYPES.PLAN && view.levelId === id);
                      if (plan) onOpenView?.(plan.id);
                    }}
                    title="Clique para definir o nível ativo; duplo clique para abrir a planta"
                  >
                    <span>{level.name ?? "Nível"}</span>
                    <span style={S.elevation}>{Number(level.elevation ?? 0).toFixed(2)} m</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {activeView && (
        <div style={S.properties}>
          <div style={S.propertiesHeader}>
            <div style={S.propertiesTitle}>Propriedades da vista</div>
            <button style={S.fitButton} onClick={onFitView}>Enquadrar</button>
          </div>
          <label style={S.field}>
            Nome
            <input
              style={S.input}
              value={activeView.name}
              onChange={(event) => patchActiveView({ name: event.target.value })}
            />
          </label>

          {activeView.type === VIEW_TYPES.PLAN && (
            <>
              <label style={S.field}>
                Nível associado
                <select
                  style={S.input}
                  value={activeView.levelId ?? ""}
                  onChange={(event) => patchActiveView({ levelId: event.target.value })}
                >
                  {levels.map((level) => (
                    <option key={level.guid ?? level.id} value={level.guid ?? level.id}>{level.name}</option>
                  ))}
                </select>
              </label>
              {[
                ["topOffset", "Plano superior"],
                ["cutOffset", "Plano de corte"],
                ["bottomOffset", "Plano inferior"],
                ["depthOffset", "Profundidade"],
              ].map(([key, label]) => (
                <label key={key} style={S.field}>
                  {label} (m)
                  <input
                    style={S.input}
                    type="number"
                    step="0.1"
                    value={activeView.viewRange?.[key] ?? 0}
                    onChange={(event) => patchActiveView({
                      viewRange: {
                        ...(activeView.viewRange ?? {}),
                        [key]: numberValue(event.target.value),
                      },
                    })}
                  />
                </label>
              ))}
            </>
          )}

          {(activeView.type === VIEW_TYPES.ELEVATION || activeView.type === VIEW_TYPES.SECTION) && (
            <>
              <label style={S.field}>
                Profundidade da vista (m)
                <input
                  style={S.input}
                  type="number"
                  min="0.1"
                  step="1"
                  value={activeView.type === VIEW_TYPES.SECTION ? activeView.farOffset ?? 30 : activeView.depth ?? 1000}
                  onChange={(event) => patchActiveView(
                    activeView.type === VIEW_TYPES.SECTION
                      ? { farOffset: Math.max(0.1, numberValue(event.target.value, 30)) }
                      : { depth: Math.max(0.1, numberValue(event.target.value, 1000)) },
                  )}
                />
              </label>
              {activeView.type === VIEW_TYPES.SECTION && (
                <>
                  <div style={S.twoColumns}>
                    <label style={S.field}>
                      Largura (m)
                      <input
                        style={S.input}
                        type="number"
                        min="0.1"
                        step="1"
                        value={activeView.cropBox?.width ?? 30}
                        onChange={(event) => patchActiveView({
                          cropBox: {
                            ...(activeView.cropBox ?? {}),
                            width: Math.max(0.1, numberValue(event.target.value, 30)),
                          },
                        })}
                      />
                    </label>
                    <label style={S.field}>
                      Altura (m)
                      <input
                        style={S.input}
                        type="number"
                        min="0.1"
                        step="1"
                        value={activeView.cropBox?.height ?? 20}
                        onChange={(event) => patchActiveView({
                          cropBox: {
                            ...(activeView.cropBox ?? {}),
                            height: Math.max(0.1, numberValue(event.target.value, 20)),
                          },
                        })}
                      />
                    </label>
                  </div>
                  <button
                    style={S.actionButton}
                    onClick={() => patchActiveView({
                      direction: (activeView.direction ?? [1, 0, 0]).map((value) => -Number(value)),
                      camera: null,
                    })}
                  >
                    Inverter direção do corte
                  </button>
                </>
              )}
            </>
          )}

          {activeView.type === VIEW_TYPES.THREE_D && (
            <details>
              <summary style={S.summary}>Caixa de corte 3D</summary>
              <label style={S.checkbox}>
                <input
                  type="checkbox"
                  checked={activeView.sectionBox?.enabled === true}
                  onChange={(event) => patchActiveView({
                    sectionBox: {
                      min: activeView.sectionBox?.min ?? [-10, -10, -10],
                      max: activeView.sectionBox?.max ?? [10, 10, 10],
                      enabled: event.target.checked,
                    },
                  })}
                />
                Ativar caixa de corte
              </label>
              {activeView.sectionBox?.enabled && ["X", "Y", "Z"].map((axis, index) => (
                <div key={axis} style={S.twoColumns}>
                  <label style={S.field}>
                    {axis} mínimo
                    <input
                      style={S.input}
                      type="number"
                      step="0.5"
                      value={activeView.sectionBox?.min?.[index] ?? -10}
                      onChange={(event) => {
                        const min = [...(activeView.sectionBox?.min ?? [-10, -10, -10])];
                        min[index] = numberValue(event.target.value, -10);
                        patchActiveView({ sectionBox: { ...(activeView.sectionBox ?? {}), min } });
                      }}
                    />
                  </label>
                  <label style={S.field}>
                    {axis} máximo
                    <input
                      style={S.input}
                      type="number"
                      step="0.5"
                      value={activeView.sectionBox?.max?.[index] ?? 10}
                      onChange={(event) => {
                        const max = [...(activeView.sectionBox?.max ?? [10, 10, 10])];
                        max[index] = numberValue(event.target.value, 10);
                        patchActiveView({ sectionBox: { ...(activeView.sectionBox ?? {}), max } });
                      }}
                    />
                  </label>
                </div>
              ))}
            </details>
          )}

          <details>
            <summary style={S.summary}>Visibilidade por categoria</summary>
            <div style={S.visibilityGrid}>
              {Object.entries(CATEGORY_LABELS).map(([category, label]) => (
                <label key={category} style={S.checkbox}>
                  <input
                    type="checkbox"
                    checked={activeView.visibility?.[category] !== false}
                    onChange={(event) => patchActiveView({
                      visibility: {
                        ...(activeView.visibility ?? {}),
                        [category]: event.target.checked,
                      },
                    })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        </div>
      )}
    </aside>
  );
}

const S = {
  panel: {
    position: "absolute",
    left: 12,
    bottom: 12,
    width: 286,
    maxHeight: "calc(100% - 84px)",
    display: "flex",
    flexDirection: "column",
    background: "rgba(17,24,39,0.96)",
    color: "#e5e7eb",
    border: "1px solid #374151",
    borderRadius: 10,
    boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
    zIndex: 21,
    font: "12px system-ui, sans-serif",
    overflow: "hidden",
  },
  collapsedButton: {
    position: "absolute",
    left: 12,
    bottom: 12,
    zIndex: 21,
    padding: "8px 10px",
    background: "rgba(17,24,39,0.96)",
    color: "#e5e7eb",
    border: "1px solid #4b5563",
    borderRadius: 8,
    cursor: "pointer",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "9px 10px",
    borderBottom: "1px solid #374151",
  },
  iconButton: { background: "transparent", color: "#9ca3af", border: 0, cursor: "pointer", fontSize: 16 },
  tree: { overflowY: "auto", minHeight: 120, maxHeight: 330, padding: "5px 0" },
  groupButton: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "14px 1fr auto",
    alignItems: "center",
    gap: 4,
    padding: "5px 8px",
    background: "transparent",
    color: "#d1d5db",
    border: 0,
    cursor: "pointer",
    textAlign: "left",
    fontWeight: 600,
  },
  count: { color: "#6b7280", fontSize: 10 },
  groupItems: { paddingLeft: 12 },
  item: { display: "flex", alignItems: "center", minHeight: 28, borderLeft: "2px solid transparent" },
  activeItem: { background: "#1e3a5f", borderLeftColor: "#60a5fa" },
  itemMain: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    textAlign: "left",
    padding: "5px 4px",
    background: "transparent",
    color: "#e5e7eb",
    border: 0,
    cursor: "pointer",
    fontSize: 11,
  },
  miniButton: { width: 22, height: 22, padding: 0, background: "transparent", color: "#9ca3af", border: 0, cursor: "pointer" },
  levelItem: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "5px 8px",
    background: "transparent",
    color: "#d1d5db",
    border: 0,
    borderLeft: "2px solid transparent",
    cursor: "pointer",
    fontSize: 11,
  },
  activeLevel: { background: "#164e63", borderLeftColor: "#22d3ee" },
  elevation: { color: "#93c5fd", fontFamily: "monospace" },
  addButton: { margin: "4px 6px 6px", padding: "4px 7px", background: "#374151", color: "#e5e7eb", border: "1px solid #4b5563", borderRadius: 4, cursor: "pointer", fontSize: 11 },
  empty: { padding: "5px 8px", color: "#6b7280", fontSize: 11 },
  properties: { borderTop: "1px solid #374151", padding: 8, overflowY: "auto", maxHeight: 320 },
  propertiesHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  propertiesTitle: { fontWeight: 700, color: "#93c5fd" },
  fitButton: { padding: "2px 6px", background: "#1f2937", color: "#bfdbfe", border: "1px solid #4b5563", borderRadius: 4, cursor: "pointer", fontSize: 10 },
  field: { display: "flex", flexDirection: "column", gap: 2, marginBottom: 5, fontSize: 10, color: "#9ca3af" },
  input: { width: "100%", boxSizing: "border-box", padding: "3px 4px", background: "#111827", color: "#e5e7eb", border: "1px solid #4b5563", borderRadius: 4, fontSize: 11 },
  summary: { cursor: "pointer", color: "#d1d5db", marginTop: 4 },
  twoColumns: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  actionButton: { width: "100%", marginBottom: 6, padding: "4px 6px", background: "#1f2937", color: "#e5e7eb", border: "1px solid #4b5563", borderRadius: 4, cursor: "pointer", fontSize: 10 },
  visibilityGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 5 },
  checkbox: { display: "flex", alignItems: "center", gap: 3, color: "#9ca3af", fontSize: 10 },
};
