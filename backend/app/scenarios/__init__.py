import json
from pathlib import Path
from ..models import Scenario


def sample() -> Scenario:
    path = Path(__file__).resolve().parents[3] / 'sample-data' / 'surat-yard.json'
    return Scenario.model_validate(json.loads(path.read_text(encoding='utf-8')))
