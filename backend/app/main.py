import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .models import Scenario, Task
from .optimizer import optimize
from .baselines import compare
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


def create_app(db_path: str | None = None):
    app = FastAPI(title='DryStock', version='0.1.0', description='Simulated recycling-yard protection planning')
    store = Store(db_path or os.environ.get('DRYSTOCK_DB', str(Path(__file__).resolve().parents[1] / 'drystock.sqlite3')))
    app.state.store = store
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
        return {'status': 'ok', 'mode': 'simulated'}

    @app.get('/api/state')
    def state():
        return store.state()

    @app.post('/api/plans')
    def generate(body: Revision):
        current = store.state()
        if body.revision != current['revision']:
            raise Conflict('Yard changed. Refresh and try again.')
        scenario = Scenario.model_validate(current['scenario'])
        plan = optimize(scenario)
        if plan.solver_status not in ('OPTIMAL', 'FEASIBLE'):
            raise HTTPException(503, 'Solver did not find a plan; retry or simplify the scenario')
        comparisons = compare(scenario)
        store.save_plan(body.revision, plan, comparisons)
        return store.state()

    @app.post('/api/plans/{pid}/approve')
    def approve(pid: str, body: Revision):
        store.approve(pid, body.revision)
        return store.state()

    @app.post('/api/plans/{pid}/tasks/{lot_id}/complete')
    def complete(pid: str, lot_id: str, body: Revision):
        store.complete(pid, lot_id, body.revision)
        return store.state()

    @app.post('/api/disruptions')
    def disrupt(body: Disruption):
        store.disrupt(**body.model_dump())
        return store.state()

    @app.post('/api/reset')
    def reset(body: Revision):
        store.reset(body.revision)
        return store.state()

    @app.get('/api/plans')
    def history():
        return store.history()

    @app.post('/api/validate')
    def validation(body: ValidateRequest):
        return validate(body.scenario, body.tasks)

    return app


app = create_app()
