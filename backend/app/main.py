import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from .models import Scenario, Task
from .compute import ComputeBackend, ComputeUnavailable
from .engine import SolverUnavailable, InvalidResult, validate_input
from .validator import validate
from .store import Store, Conflict
from .local_sessions import LocalSessions
from .scenario_input import ScenarioInput


class Revision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)


class Disruption(Revision):
    deadline: int = Field(ge=0, le=240)
    now_minute: int = Field(ge=0, le=240)
    disabled_workers: list[str] = Field(default_factory=list)
    forklift_enabled: bool = True


class ValidateRequest(BaseModel):
    scenario: Scenario
    tasks: list[Task] = Field(max_length=30)


def create_app(db_path: str | None = None, compute_backend: ComputeBackend | None = None):
    app = FastAPI(title='DryStock', version='0.1.0', description='Simulated recycling-yard protection planning')
    store = Store(db_path or os.environ.get('DRYSTOCK_DB', str(Path(__file__).resolve().parents[1] / 'drystock.sqlite3')))
    app.state.store = store
    sessions = LocalSessions(store.path)
    compute = compute_backend or ComputeBackend()
    app.state.compute = compute

    def current_store(request: Request):
        authorization = request.headers.get('authorization')
        return sessions.load(authorization, compute=request.method == 'POST' and request.url.path == '/api/plans') if authorization else store

    def snapshot(selected: Store):
        return {**selected.state(), 'compute_backend': compute.mode}

    @app.middleware('http')
    async def bounded_requests(request: Request, call_next):
        from fastapi.responses import JSONResponse
        if request.method == 'POST':
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 32768:
                    return JSONResponse(status_code=413, content={'detail': 'Request exceeds 32 KiB'})
            request._body = bytes(body)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:3000', 'http://127.0.0.1:3000'], allow_methods=['GET', 'POST'], allow_headers=['Content-Type','Authorization'])

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
    def state(selected: Store = Depends(current_store)):
        return snapshot(selected)

    @app.post('/api/sessions', status_code=201)
    def session(body: dict):
        if body:
            raise HTTPException(422, 'Session creation accepts no scenario data')
        return sessions.create()

    @app.post('/api/scenario')
    def scenario(body: ScenarioInput, request: Request, selected: Store = Depends(current_store)):
        if not request.headers.get('authorization'):
            raise HTTPException(401, 'Custom inputs require a demo session')
        selected.replace_scenario(body.revision, body.scenario)
        return snapshot(selected)

    @app.post('/api/plans')
    def generate(body: Revision, selected: Store = Depends(current_store)):
        current = selected.state()
        if body.revision != current['revision']:
            raise Conflict('Yard changed. Refresh and try again.')
        scenario = Scenario.model_validate(current['scenario'])
        result = compute.generate(scenario)
        selected.save_plan(body.revision, result.plan, result.comparisons, result.model_dump(exclude={'plan','comparisons'}))
        return snapshot(selected)

    @app.post('/api/plans/{pid}/approve')
    def approve(pid: str, body: Revision, selected: Store = Depends(current_store)):
        selected.approve(pid, body.revision)
        return snapshot(selected)

    @app.post('/api/plans/{pid}/tasks/{lot_id}/complete')
    def complete(pid: str, lot_id: str, body: Revision, selected: Store = Depends(current_store)):
        selected.complete(pid, lot_id, body.revision)
        return snapshot(selected)

    @app.post('/api/disruptions')
    def disrupt(body: Disruption, selected: Store = Depends(current_store)):
        selected.disrupt(**body.model_dump())
        return snapshot(selected)

    @app.post('/api/reset')
    def reset(body: Revision, selected: Store = Depends(current_store)):
        selected.reset(body.revision)
        return snapshot(selected)

    @app.get('/api/plans')
    def history(selected: Store = Depends(current_store)):
        return selected.history()

    @app.post('/api/validate')
    def validation(body: ValidateRequest, selected: Store = Depends(current_store)):
        validate_input(body.scenario)
        return validate(body.scenario, body.tasks)

    return app


app = create_app()
