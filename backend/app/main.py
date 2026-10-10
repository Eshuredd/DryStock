import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .models import Scenario, Task
from .compute import ComputeBackend, ComputeUnavailable
from .engine import SolverUnavailable, InvalidResult
from .validator import validate
from .store import Store, Conflict


class Revision(BaseModel):
    revision: int = Field(ge=0)


class Disruption(Revision):
    deadline: int = Field(ge=0, le=240)
    now_minute: int = Field(ge=0, le=240)
    disabled_workers: list[str] = Field(default_factory=list)
    forklift_enabled: bool = True


class ValidateRequest(BaseModel):
    scenario: Scenario
    tasks: list[Task]


def create_app(db_path: str | None = None, compute_backend: ComputeBackend | None = None):
    app = FastAPI(title='DryStock', version='0.1.0', description='Simulated recycling-yard protection planning')
    store = Store(db_path or os.environ.get('DRYSTOCK_DB', str(Path(__file__).resolve().parents[1] / 'drystock.sqlite3')))
    app.state.store = store
    compute = compute_backend or ComputeBackend()
    app.state.compute = compute

    def snapshot():
        return {**store.state(), 'compute_backend': compute.mode}
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:3000', 'http://127.0.0.1:3000'], allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    @app.exception_handler(Conflict)
    async def conflict_handler(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=409, content={'detail': str(exc)})

    @app.exception_handler(ValueError)
    async def value_handler(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=422, content={'detail': str(exc)})

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'mode': 'simulated', 'compute_backend': compute.mode}

    @app.exception_handler(ComputeUnavailable)
    @app.exception_handler(SolverUnavailable)
    async def compute_unavailable(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=503, content={'detail': str(exc)})

    @app.exception_handler(InvalidResult)
    async def invalid_result(request, exc):
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=502, content={'detail': 'Compute output failed independent validation'})

    @app.get('/api/state')
    def state():
        return snapshot()

    @app.post('/api/plans')
    def generate(body: Revision):
        current = store.state()
        if body.revision != current['revision']:
            raise Conflict('Yard changed. Refresh and try again.')
        scenario = Scenario.model_validate(current['scenario'])
        result = compute.generate(scenario)
        store.save_plan(body.revision, result.plan, result.comparisons, result.model_dump(exclude={'plan','comparisons'}))
        return snapshot()

    @app.post('/api/plans/{pid}/approve')
    def approve(pid: str, body: Revision):
        store.approve(pid, body.revision)
        return snapshot()

    @app.post('/api/plans/{pid}/tasks/{lot_id}/complete')
    def complete(pid: str, lot_id: str, body: Revision):
        store.complete(pid, lot_id, body.revision)
        return snapshot()

    @app.post('/api/disruptions')
    def disrupt(body: Disruption):
        store.disrupt(**body.model_dump())
        return snapshot()

    @app.post('/api/reset')
    def reset(body: Revision):
        store.reset(body.revision)
        return snapshot()

    @app.get('/api/plans')
    def history():
        return store.history()

    @app.post('/api/validate')
    def validation(body: ValidateRequest):
        return validate(body.scenario, body.tasks)

    return app


app = create_app()
