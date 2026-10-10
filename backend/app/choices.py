"""Enumerate compatible assignments; no solver or validator dependencies."""
from itertools import combinations, product
from .models import Scenario, Lot, Action


def assignments(s: Scenario, lot: Lot, action: Action):
    used_tarps = {t.tarp_id for t in s.completed}
    used_storage = {t.storage_id for t in s.completed}
    workers = [w for w in s.workers if w.enabled and set(action.required_skills) <= set(w.skills)]
    tarps = [r.id for r in s.tarps if r.enabled and r.id not in used_tarps and lot.weight_kg <= r.capacity_kg and lot.category in r.categories] if action.kind == 'cover' else [None]
    storage = [r.id for r in s.storage if r.enabled and r.id not in used_storage and lot.weight_kg <= r.capacity_kg and lot.category in r.categories] if action.kind == 'relocate' else [None]
    forklifts = [f.id for f in s.forklifts if f.enabled] if action.forklift else [None]
    for crew, tarp, position, forklift in product(combinations(workers, action.workers), tarps, storage, forklifts):
        selected_f = next((f for f in s.forklifts if f.id == forklift), None)
        earliest = max([s.now_minute] + [w.available_from for w in crew] + ([selected_f.available_from] if selected_f else []))
        latest = min([s.deadline] + [w.available_until for w in crew] + ([selected_f.available_until] if selected_f else []))
        if earliest + action.duration <= latest:
            yield tuple(w.id for w in crew), tarp, position, forklift, earliest, latest
