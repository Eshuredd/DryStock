from typing import Literal
from pydantic import BaseModel, Field, model_validator


class Action(BaseModel):
    kind: Literal['cover', 'relocate']
    duration: int = Field(ge=1, le=240)
    workers: int = Field(ge=1, le=10)
    forklift: bool = False
    required_skills: list[str] = Field(default_factory=list)
    effectiveness_bps: int = Field(ge=1, le=10000)


class Lot(BaseModel):
    id: str
    category: str
    description: str
    weight_kg: int = Field(gt=0)
    location: str
    exposure: Literal['high', 'medium', 'low']
    condition: str
    value_inr: int = Field(ge=0)
    vulnerability: int = Field(ge=1, le=5)
    exposed_loss_inr: int = Field(ge=0)
    restrictions: list[str] = Field(default_factory=list)
    actions: list[Action]
    protection_status: Literal['exposed', 'already_protected'] = 'exposed'

    @model_validator(mode='after')
    def consistency(self):
        if self.exposed_loss_inr > self.value_inr:
            raise ValueError('Expected loss must not exceed material value')
        if len({a.kind for a in self.actions}) != len(self.actions):
            raise ValueError('Action kinds must be unique within a lot')
        return self


class Worker(BaseModel):
    id: str
    name: str
    skills: list[str] = Field(default_factory=list)
    available_from: int = Field(default=0, ge=0)
    available_until: int = Field(default=240, ge=0)
    enabled: bool = True


class Resource(BaseModel):
    id: str
    name: str
    capacity_kg: int = Field(gt=0)
    categories: list[str]
    enabled: bool = True


class Forklift(BaseModel):
    id: str
    name: str
    available_from: int = Field(default=0, ge=0)
    available_until: int = Field(default=240, ge=0)
    enabled: bool = True


class Task(BaseModel):
    lot_id: str
    action: Literal['cover', 'relocate']
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    worker_ids: list[str]
    forklift_id: str | None = None
    tarp_id: str | None = None
    storage_id: str | None = None
    saved_loss_inr: int = Field(ge=0)


class Scenario(BaseModel):
    id: str = 'monsoon-yard'
    name: str = 'Surat Paper Recovery Yard'
    weather_label: str = 'SIMULATED · approaching heavy rain'
    rain_arrival_minute: int = Field(default=70, ge=0, le=240)
    safety_buffer_minutes: int = Field(default=10, ge=0, le=120)
    deadline: int = Field(default=60, ge=0, le=240)
    now_minute: int = Field(default=0, ge=0, le=240)
    lots: list[Lot]
    workers: list[Worker]
    forklifts: list[Forklift]
    tarps: list[Resource]
    storage: list[Resource]
    completed: list[Task] = Field(default_factory=list)

    @model_validator(mode='after')
    def consistency(self):
        for items in [self.lots, self.workers, self.forklifts, self.tarps, self.storage]:
            if len({i.id for i in items}) != len(items):
                raise ValueError('Identifiers must be unique within each resource group')
        if len({t.lot_id for t in self.completed}) != len(self.completed):
            raise ValueError('A lot may only have one completed action')
        if self.deadline > self.rain_arrival_minute - self.safety_buffer_minutes:
            raise ValueError('Handling cutoff must precede rain by the safety buffer')
        if self.now_minute > self.deadline:
            raise ValueError('Elapsed time must not exceed the handling cutoff')
        if any(t.end > self.now_minute for t in self.completed):
            raise ValueError('Completed tasks must finish by the scenario clock')
        return self


class Validation(BaseModel):
    valid: bool
    errors: list[str]


class Plan(BaseModel):
    strategy: str
    solver_status: str
    tasks: list[Task]
    unprotected_lot_ids: list[str]
    initial_loss_inr: int
    completed_saved_inr: int
    planned_saved_inr: int
    residual_loss_inr: int
    solve_seconds: float = 0
    best_bound_inr: int | None = None
    validation: Validation | None = None


def benefit(lot: Lot, action: Action) -> int:
    return lot.exposed_loss_inr * action.effectiveness_bps // 10000
