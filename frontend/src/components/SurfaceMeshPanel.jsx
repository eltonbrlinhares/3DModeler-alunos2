/**
 * SurfaceMeshPanel.jsx
 *
 * Painel flutuante para gerar malha de elementos finitos em uma superfície.
 * Suporta malha 2D (superfície única) e malha 3D por template hexaédrico
 * (múltiplas superfícies com malha 2D já gerada).
 */

import { useState } from "react";

const ALGORITHMS = [
  { id: "bilinear",     label: "Bilinear",          hasUV: true,  defaultElem: 4, is3D: false },
  { id: "bilinear",     label: "Bilinear T3",        hasUV: true,  defaultElem: 3, is3D: false },
  { id: "collbilinear", label: "CollBilinear T3",    hasUV: true,  defaultElem: 3, is3D: false },
  { id: "loft",         label: "Loft Q4",            hasUV: true,  defaultElem: 4, is3D: false },
  { id: "loft",         label: "Loft T3",            hasUV: true,  defaultElem: 3, is3D: false },
  { id: "trilinear",    label: "Trilinear T3",       hasUV: false, defaultElem: 3, is3D: false },
  { id: "template",     label: "Template Q4",        hasUV: false, defaultElem: 4, is3D: false },
  { id: "3d_template",  label: "Template 3D H8",     hasUV: false, defaultElem: 8, is3D: true  },
];

const ALGO_LIST = ALGORITHMS.map((a, i) => ({ ...a, key: `${a.id}_${a.defaultElem}_${i}` }));

const ELEM_NAMES = { 3: "T3", 4: "Q4", 6: "T6", 8: "H8" };

const BTN = {
  width: "100%",
  padding: "7px 0",
  borderRadius: 5,
  border: "none",
  fontFamily: "monospace",
  fontWeight: "bold",
  fontSize: 13,
  cursor: "pointer",
};

const INPUT = {
  display: "block",
  width: "100%",
  background: "#1e293b",
  color: "#f1f5f9",
  border: "1px solid #475569",
  borderRadius: 4,
  padding: "4px 6px",
  fontSize: 13,
  boxSizing: "border-box",
  marginTop: 3,
};

const LABEL_S = { display: "block", marginBottom: 10 };
const HINT    = { color: "#94a3b8", fontSize: 11, display: "block" };

export default function SurfaceMeshPanel({
  open,
  hasSurface,
  subdivs,
  loading,
  error,
  result,
  onGenerate,
  onClose,
}) {
  const [algoKey, setAlgoKey] = useState(ALGO_LIST[0].key);

  if (!open) return null;

  const algo = ALGO_LIST.find((a) => a.key === algoKey) ?? ALGO_LIST[0];
  const surfaceCount = subdivs?.surfaceCount ?? 1;
  const isMulti = surfaceCount > 1;

  // Para Template 3D requer múltiplas superfícies; para 2D requer exatamente 1
  const canGenerate = hasSurface && !loading
    && (algo.is3D ? isMulti : !isMulti);

  const handleGenerate = () => {
    if (!canGenerate) return;
    onGenerate({ algo: algo.id, elem_type: algo.defaultElem });
  };

  const modeHint = algo.is3D
    ? `Selecione ${surfaceCount < 2 ? "2+" : surfaceCount} superfícies com malha 2D gerada`
    : "Selecione exatamente 1 superfície";

  return (
    <div
      style={{
        position: "absolute",
        top: 50,
        left: 62,
        background: "#0f172a",
        color: "#f1f5f9",
        borderRadius: 8,
        padding: "14px 16px",
        width: 230,
        zIndex: 20,
        fontSize: 13,
        boxShadow: "0 4px 24px #0009",
        border: "1px solid #334155",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: "bold", color: "#a5f3fc" }}>Malha de Superfície</span>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
          title="Fechar"
        >✕</button>
      </div>

      {/* Algorithm */}
      <label style={LABEL_S}>
        <span style={HINT}>ALGORITMO</span>
        <select
          value={algoKey}
          onChange={(e) => setAlgoKey(e.target.value)}
          style={{ ...INPUT }}
        >
          {ALGO_LIST.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label} ({ELEM_NAMES[a.defaultElem]})
            </option>
          ))}
        </select>
      </label>

      {/* Info de seleção */}
      <div style={{ marginBottom: 10 }}>
        {algo.is3D ? (
          <>
            <span style={HINT}>SUPERFÍCIES SELECIONADAS</span>
            <div style={{
              marginTop: 4,
              padding: "5px 8px",
              background: "#1e293b",
              borderRadius: 4,
              border: "1px solid #334155",
              fontSize: 12,
              color: isMulti ? "#a5f3fc" : "#64748b",
            }}>
              {isMulti
                ? `${surfaceCount} superfícies — prontas para Template 3D`
                : "— selecione 2 ou mais superfícies com malha 2D —"}
            </div>
          </>
        ) : algo.hasUV && (
          <>
            <span style={HINT}>DIVISÕES (das curvas do contorno)</span>
            <div style={{
              marginTop: 4,
              padding: "5px 8px",
              background: "#1e293b",
              borderRadius: 4,
              border: "1px solid #334155",
              fontSize: 12,
              color: subdivs && !isMulti ? "#a5f3fc" : "#64748b",
            }}>
              {subdivs && !isMulti
                ? `U: ${subdivs.u} seg${subdivs.ratioU && Math.abs(subdivs.ratioU - 1) > 0.01 ? ` r${subdivs.ratioU.toFixed(2)}` : ""} · V: ${subdivs.v} seg${subdivs.ratioV && Math.abs(subdivs.ratioV - 1) > 0.01 ? ` r${subdivs.ratioV.toFixed(2)}` : ""}`
                : "— selecione uma superfície —"}
            </div>
          </>
        )}
      </div>

      {/* Hint de modo */}
      {hasSurface && !canGenerate && (
        <div style={{ color: "#fbbf24", fontSize: 11, marginBottom: 8 }}>
          ⚠ {modeHint}
        </div>
      )}
      {!hasSurface && (
        <div style={{ color: "#fbbf24", fontSize: 11, marginBottom: 8 }}>
          Clique em uma superfície para selecioná-la.
        </div>
      )}

      {/* Status */}
      {error && (
        <div style={{ color: "#f87171", fontSize: 11, marginBottom: 8, wordBreak: "break-word" }}>
          ✗ {error}
        </div>
      )}
      {result && !error && (
        <div style={{ color: "#86efac", fontSize: 11, marginBottom: 8 }}>
          ✓ {result.n_nodes} nós · {result.n_elements} elementos
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={!canGenerate}
        style={{
          ...BTN,
          background: canGenerate ? "#0369a1" : "#1e293b",
          color:      canGenerate ? "#e0f2fe" : "#475569",
        }}
      >
        {loading ? "Gerando…" : algo.is3D ? "Gerar Malha 3D" : "Gerar Malha"}
      </button>
    </div>
  );
}
