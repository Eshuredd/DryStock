"""The stateless compute contract shared by FastAPI and AWS Lambda."""
import hashlib
import json
import platform
from typing import Literal
from ortools import __version__ as ortools_version
from pydantic import BaseModel, ConfigDict, Field
from .models import Scenario, Plan
from .optimizer import optimize
from .baselines import compare
from .validator import validate_plan, validate

ASSUMPTIONS = [
    'Fictional weather, prices, loss estimates and effectiveness; not measured savings.',
    'Whole lots; one protection action per lot; tarps and bays remain occupied through rain.',
    'Integer-minute handling durations; no travel/setup or partial/in-progress operations.',
    'Completion is simulated operator attestation at scheduled times, not physical verification.',
    'Kilograms scheduled are not kilograms of waste prevented.',
]
STRATEGIES = ['Highest value first', 'Highest loss first', 'Loss per worker-minute']


class ComputeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    scenario: Scenario
    solver_seconds: float = Field(default=5, ge=0.01, le=10)


class ComputeResult(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schema_version: Literal['1'] = '1'
    execution_backend: Literal['local', 'sam', 'aws']
    scenario_sha256: str
    plan: Plan
    comparisons: list[Plan]
    assumptions: list[str]
    runtime: dict[str, str]


class InvalidScenario(ValueError):
    pass


class InvalidResult(RuntimeError):
    pass


class SolverUnavailable(RuntimeError):
    def __init__(self, status: str):
        self.status = status
        super().__init__('No solution returned: ' + status)


def scenario_hash(s: Scenario) -> str:
    return hashlib.sha256(json.dumps(s.model_dump(), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_input(s: Scenario):
    # Bound assignment enumeration in a public-shaped stateless handler. The demo is 12/3/1/3/2.
    if len(s.lots) > 30 or len(s.workers) > 6 or len(s.forklifts) > 3 or len(s.tarps) > 6 or len(s.storage) > 6:
        raise InvalidScenario('MVP limit: 30 lots, 6 workers, 3 forklifts, 6 tarps, 6 bays')
    result = validate(s, [])
    if not result.valid:
        raise InvalidScenario('Completed history failed independent validation')


def verify_result(s: Scenario, result: ComputeResult) -> ComputeResult:
    """Do not trust remotely supplied validation flags, totals or the scenario identity."""
    if result.scenario_sha256 != scenario_hash(s):
        raise InvalidResult('Compute result does not match the requested scenario')
    if result.plan.strategy != 'CP-SAT' or result.plan.solver_status not in ('OPTIMAL', 'FEASIBLE'):
        raise InvalidResult('Compute result has no usable solver solution')
    if any(p.execution_backend != result.execution_backend for p in [result.plan, *result.comparisons]):
        raise InvalidResult('Inconsistent execution provenance')
    if [p.strategy for p in result.comparisons] != STRATEGIES:
        raise InvalidResult('Missing, duplicated or reordered baseline strategies')
    if any(p.solver_status != 'GREEDY' for p in result.comparisons):
        raise InvalidResult('Invalid baseline status')
    for p in [result.plan, *result.comparisons]:
        checked = validate_plan(s, p)
        if not checked.valid:
            raise InvalidResult('Independent output validation failed: ' + '; '.join(checked.errors))
        p.validation = checked
    return result


def execute(request: ComputeRequest, backend: Literal['local', 'sam', 'aws'] = 'local') -> ComputeResult:
    validate_input(request.scenario)
    plan = optimize(request.scenario, time_limit=request.solver_seconds)
    if plan.solver_status not in ('OPTIMAL', 'FEASIBLE'):
        raise SolverUnavailable(plan.solver_status)
    plan.execution_backend = backend
    comparisons = compare(request.scenario)
    for p in comparisons:
        p.execution_backend = backend
    result = ComputeResult(execution_backend=backend, scenario_sha256=scenario_hash(request.scenario), plan=plan,
        comparisons=comparisons, assumptions=ASSUMPTIONS,
        runtime={'python': platform.python_version(), 'ortools': ortools_version})
    return verify_result(request.scenario, result)
