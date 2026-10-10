"""FastAPI adapter: local execution or the real SAM local API, never a fallback."""
import json
import os
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from pydantic import ValidationError
from .engine import ComputeRequest, ComputeResult, execute, verify_result, validate_input, InvalidResult


class ComputeUnavailable(RuntimeError):
    pass


class ComputeBackend:
    def __init__(self, mode: str | None = None, endpoint: str | None = None):
        self.mode = mode or os.environ.get('DRYSTOCK_COMPUTE_BACKEND', 'local')
        self.endpoint = endpoint or os.environ.get('DRYSTOCK_SAM_URL', 'http://127.0.0.1:3001/optimize')
        if self.mode not in ('local', 'sam'):
            raise ValueError('DRYSTOCK_COMPUTE_BACKEND must be local or sam')
        parsed = urlparse(self.endpoint)
        if self.mode == 'sam' and (parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost', '::1') or parsed.username or parsed.password):
            raise ValueError('SAM mode only accepts a loopback HTTP endpoint; no public unauthenticated API')

    def generate(self, scenario):
        request = ComputeRequest(scenario=scenario)
        if self.mode == 'local':
            return execute(request)
        validate_input(scenario)
        try:
            http_request = Request(self.endpoint, data=request.model_dump_json().encode(), headers={'Content-Type': 'application/json'}, method='POST')
            with urlopen(http_request, timeout=35) as r:
                payload = json.load(r)
            result = ComputeResult.model_validate(payload)
            if result.execution_backend != 'sam':
                raise InvalidResult('Expected a SAM execution response')
            return verify_result(scenario, result)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, ValidationError, InvalidResult) as exc:
            raise ComputeUnavailable('SAM execution failed or returned invalid results. No local fallback was used.') from exc
