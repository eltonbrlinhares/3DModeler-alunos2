export const VIEW_TYPES = Object.freeze({
  THREE_D: "3d",
  PLAN: "plan",
  ELEVATION: "elevation",
  SECTION: "section",
});

export const DEFAULT_VISIBILITY = Object.freeze({
  foundation: true,
  column: true,
  beam: true,
  slab: true,
  wall: true,
  grid: true,
  level: true,
  dimension: true,
  generic: true,
});

const DEFAULT_PLAN_RANGE = Object.freeze({
  topOffset: 2.3,
  cutOffset: 1.2,
  bottomOffset: 0,
  depthOffset: -0.5,
});

function cloneVisibility(value = {}) {
  return { ...DEFAULT_VISIBILITY, ...value };
}

function safeId(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || Math.random().toString(36).slice(2, 9);
}

export function create3DView(overrides = {}) {
  return {
    id: "view-3d-default",
    name: "Vista 3D padrão",
    type: VIEW_TYPES.THREE_D,
    projection: "perspective",
    generated: true,
    camera: null,
    sectionBox: null,
    ...overrides,
    visibility: cloneVisibility(overrides.visibility),
  };
}

export function createPlanView(level, overrides = {}) {
  const levelId = level?.guid ?? level?.id;
  return {
    id: `view-plan-${safeId(levelId)}`,
    name: `Planta estrutural - ${level?.name ?? "Nível"}`,
    type: VIEW_TYPES.PLAN,
    projection: "orthographic",
    generated: true,
    levelId,
    camera: null,
    ...overrides,
    visibility: cloneVisibility(overrides.visibility ?? { level: false }),
    viewRange: { ...DEFAULT_PLAN_RANGE, ...(overrides.viewRange ?? {}) },
  };
}

export function createElevationViews() {
  return [
    {
      id: "view-elevation-north",
      name: "Elevação Norte",
      direction: [0, 1, 0],
      up: [0, 0, 1],
    },
    {
      id: "view-elevation-south",
      name: "Elevação Sul",
      direction: [0, -1, 0],
      up: [0, 0, 1],
    },
    {
      id: "view-elevation-east",
      name: "Elevação Leste",
      direction: [-1, 0, 0],
      up: [0, 0, 1],
    },
    {
      id: "view-elevation-west",
      name: "Elevação Oeste",
      direction: [1, 0, 0],
      up: [0, 0, 1],
    },
  ].map((view) => ({
    ...view,
    type: VIEW_TYPES.ELEVATION,
    projection: "orthographic",
    generated: true,
    camera: null,
    visibility: cloneVisibility({ level: true }),
    depth: 1000,
    cropBox: null,
  }));
}

export function createSectionView({
  name = "Corte A-A",
  origin = [0, 0, 0],
  direction = [1, 0, 0],
  up = [0, 0, 1],
  farOffset = 30,
  width = 30,
  height = 20,
} = {}) {
  const id = `view-section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    name,
    type: VIEW_TYPES.SECTION,
    projection: "orthographic",
    generated: false,
    origin,
    direction,
    up,
    nearOffset: 0,
    farOffset,
    cropBox: { width, height },
    camera: null,
    visibility: cloneVisibility({ level: true }),
  };
}

export function reconcileViews(existingViews = [], levels = []) {
  const byId = new Map((existingViews ?? []).map((view) => [view.id, normalizeView(view)]));

  if (![...byId.values()].some((view) => view.type === VIEW_TYPES.THREE_D)) {
    const view = create3DView();
    byId.set(view.id, view);
  }

  for (const elevation of createElevationViews()) {
    if (!byId.has(elevation.id)) byId.set(elevation.id, elevation);
  }

  const validLevelIds = new Set(levels.map((level) => level.guid ?? level.id));
  for (const level of levels) {
    const levelId = level.guid ?? level.id;
    const existing = [...byId.values()].find(
      (view) => view.type === VIEW_TYPES.PLAN && view.levelId === levelId,
    );
    if (!existing) {
      const plan = createPlanView(level);
      byId.set(plan.id, plan);
    } else if (existing.name.startsWith("Planta estrutural - ")) {
      existing.name = `Planta estrutural - ${level.name ?? "Nível"}`;
    }
  }

  // Plantas órfãs são removidas; cortes e vistas 3D personalizadas são mantidos.
  for (const [id, view] of byId) {
    if (view.type === VIEW_TYPES.PLAN && !validLevelIds.has(view.levelId)) {
      byId.delete(id);
    }
  }

  return [...byId.values()];
}

export function normalizeView(view) {
  if (!view || typeof view !== "object") return create3DView();
  return {
    ...view,
    visibility: cloneVisibility(view.visibility),
    ...(view.type === VIEW_TYPES.PLAN
      ? { viewRange: { ...DEFAULT_PLAN_RANGE, ...(view.viewRange ?? {}) } }
      : {}),
  };
}

export function getLevelForView(view, levels) {
  if (!view?.levelId) return null;
  return levels.find((level) => (level.guid ?? level.id) === view.levelId) ?? null;
}

export function nextSectionName(views) {
  const count = views.filter((view) => view.type === VIEW_TYPES.SECTION).length;
  const index = count + 1;
  const letter = String.fromCharCode(64 + Math.min(index, 26));
  return `Corte ${letter}-${letter}`;
}
