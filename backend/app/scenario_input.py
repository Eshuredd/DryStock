"""Bounded operator inputs; never accept browser-supplied completed execution."""
import re
from pydantic import BaseModel, ConfigDict, Field
from .models import Scenario
from .engine import validate_input


class ScenarioInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)
    scenario: Scenario


def validate_custom(s: Scenario) -> Scenario:
    validate_input(s)
    if s.completed:
        raise ValueError('Completed work can only be recorded from an approved plan')
    if not s.lots:
        raise ValueError('Enter at least one material lot')
    groups = [s.lots, s.workers, s.forklifts, s.tarps, s.storage]
    for item in [s, *[item for group in groups for item in group]]:
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,31}', item.id):
            raise ValueError('IDs must be 1–32 letters, digits, underscores or hyphens')
    for text in [s.name, s.weather_label, *[l.description for l in s.lots],
                 *[l.location for l in s.lots], *[l.condition for l in s.lots],
                 *[r.name for group in groups[1:] for r in group]]:
        if not text.strip() or len(text) > 160:
            raise ValueError('Names and descriptions must contain 1–160 characters')
    tokens = [l.category for l in s.lots]
    lists = [w.skills for w in s.workers] + [r.categories for r in s.tarps + s.storage]
    for l in s.lots:
        if l.weight_kg > 1_000_000_000 or l.value_inr > 9_000_000_000:
            raise ValueError('Lot limits: 1 billion kg and ₹9 billion value')
        if len(l.restrictions) > 10 or any(len(t) > 160 for t in l.restrictions):
            raise ValueError('At most 10 restriction notes of 160 characters')
        lists += [a.required_skills for a in l.actions]
    for r in s.tarps + s.storage:
        if not r.categories or r.capacity_kg > 1_000_000_000:
            raise ValueError('Equipment needs compatible materials and capacity up to 1 billion kg')
    for items in lists:
        if len(items) > 10 or len(set(items)) != len(items):
            raise ValueError('At most 10 unique skills or compatible materials per field')
        tokens.extend(items)
    if any(not re.fullmatch(r'[a-z][a-z0-9_]{0,31}', t) for t in tokens):
        raise ValueError('Material and skill codes use lowercase letters, digits and underscores (1–32 characters)')
    categories = {l.category for l in s.lots}
    if any(not set(r.categories) <= categories for r in s.tarps + s.storage):
        raise ValueError('Compatible materials must match a material code in your lots')
    for r in s.workers + s.forklifts:
        if not 0 <= r.available_from <= r.available_until <= 240:
            raise ValueError('Availability must run forwards within minutes 0–240')
    return s
