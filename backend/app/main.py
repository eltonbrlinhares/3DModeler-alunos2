from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import connectivity, design, dimensions, edit, geometry, grids, history, levels, mesh, models, spatial, view_annotations

app = FastAPI(title="3DModeler.js IFC Backend")

app.add_middleware(
    CORSMiddleware,
    # dev: Vite pode subir em 5173/5174/… — libera qualquer porta de localhost.
    # Em produção, restringir para a origem real.
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(models.router)
app.include_router(edit.router)
app.include_router(geometry.router)
app.include_router(spatial.router)
app.include_router(levels.router)
app.include_router(grids.router)
app.include_router(history.router)
app.include_router(mesh.router)
app.include_router(design.router)
app.include_router(connectivity.router)
app.include_router(dimensions.router)
app.include_router(view_annotations.router)


@app.get("/health")
def health():
    return {"status": "ok"}
