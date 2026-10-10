import json
import os
from pathlib import Path
from ..models import Scenario


def sample() -> Scenario:
    path = Path(os.environ['DRYSTOCK_SAMPLE_PATH']) if os.environ.get('DRYSTOCK_SAMPLE_PATH') else Path(__file__).resolve().parents[3] / 'sample-data' / 'surat-yard.json'
    return Scenario.model_validate(json.loads(path.read_text(encoding='utf-8')))
