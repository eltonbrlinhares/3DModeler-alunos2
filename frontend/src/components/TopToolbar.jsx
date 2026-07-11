/**
 * src/components/TopToolbar.jsx
 *
 * Barra de ferramentas fixa no TOPO da viewport para o fluxo de modelagem de
 * paredes estilo Revit: Parede (planta 2D), 3D (extrusão) e Cota
 * (dimensionamento paramétrico). Renderizada pelo IfcPanel, que é quem detém
 * o modelo IFC/nível ativo que estas ferramentas precisam.
 *
 * Segue os padrões visuais já usados em Toolbar.jsx/IfcPanel.jsx: fundo
 * escuro, fonte monospace, estado ativo em azul.
 */

const TOOLS = [
  { id: "wall", label: "PAR", title: "Parede — desenhe o eixo em planta (clique os vértices; 2×clique/Enter/clique no 1º ponto para fechar)" },
  { id: "dimension", label: "COTA", title: "Cota — clique sobre uma parede para medi-la; clique no valor para editar" },
];

function btnStyle(active, disabled) {
  return {
    minWidth: 52,
    height: 34,
    padding: "0 10px",
    background: active ? "#1a3a5c" : "#222",
    color: disabled ? "#555" : active ? "#6af" : "#ccc",
    border: `1px solid ${active ? "#4a7abf" : "#444"}`,
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    fontWeight: "bold",
    userSelect: "none",
  };
}

export default function TopToolbar({
  sketchTool,
  onSelectTool,
  wallThickness,
  onThicknessChange,
  wallHeight,
  onHeightChange,
  onConvert3D,
  canConvert,
  is3DActive,
  busy,
  disabled,
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "rgba(17,24,39,0.95)",
        border: "1px solid #374151",
        borderRadius: 8,
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        zIndex: 16,
        font: "12px system-ui, sans-serif",
        color: "#e5e7eb",
      }}
    >
      {TOOLS.map(({ id, label, title }) => (
        <button
          key={id}
          title={title}
          disabled={disabled || busy}
          onClick={() => onSelectTool(sketchTool === id ? null : id)}
          style={btnStyle(sketchTool === id, disabled || busy)}
        >
          {label}
        </button>
      ))}

      <button
        title={
          is3DActive
            ? "3D — voltar para a planta 2D"
            : "3D — extruda as paredes desenhadas em planta com a altura configurada"
        }
        disabled={disabled || busy || !canConvert}
        onClick={onConvert3D}
        style={btnStyle(is3DActive, disabled || busy || !canConvert)}
      >
        3D
      </button>

      <div style={{ width: 1, height: 22, background: "#374151", margin: "0 4px" }} />

      {sketchTool === "wall" && (
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          espessura (m)
          <input
            type="number"
            step="0.01"
            min="0.02"
            value={wallThickness}
            onChange={(e) => onThicknessChange(e.target.value)}
            style={{ width: 56, font: "12px monospace" }}
          />
        </label>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
        altura 3D (m)
        <input
          type="number"
          step="0.1"
          min="0.1"
          value={wallHeight}
          onChange={(e) => onHeightChange(e.target.value)}
          style={{ width: 56, font: "12px monospace" }}
        />
      </label>

      {sketchTool && (
        <span style={{ color: "#9ca3af" }}>Esc = cancelar</span>
      )}
    </div>
  );
}
