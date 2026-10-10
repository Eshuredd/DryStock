"""AWS proxy response handler; no FastAPI or SQLite imports or side effects."""
import base64
import json
from pydantic import ValidationError
from .engine import ComputeRequest, execute, InvalidScenario, SolverUnavailable


def response(status: int, payload: dict):
    return {'statusCode': status, 'headers': {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
            'isBase64Encoded': False, 'body': json.dumps(payload, ensure_ascii=False)}


def handler(event, context):
    try:
        payload = event
        if isinstance(event, dict) and 'body' in event:
            body = event['body']
            if event.get('isBase64Encoded'):
                body = base64.b64decode(body, validate=True).decode('utf-8')
            payload = json.loads(body) if isinstance(body, str) else body
        request = ComputeRequest.model_validate(payload)
        if context is not None and hasattr(context, 'get_remaining_time_in_millis'):
            remaining = context.get_remaining_time_in_millis() / 1000 - 2
            if remaining < 0.01:
                return response(504, {'error': 'invocation_timeout', 'message': 'Insufficient execution time remaining'})
            request.solver_seconds = min(request.solver_seconds, remaining)
        result = execute(request, backend='sam')
        return response(200, result.model_dump())
    except (json.JSONDecodeError, UnicodeError, base64.binascii.Error):
        return response(400, {'error': 'invalid_json', 'message': 'Request body must be valid UTF-8 JSON'})
    except (ValidationError, InvalidScenario):
        return response(422, {'error': 'invalid_scenario', 'message': 'Scenario or solver limits failed validation'})
    except SolverUnavailable as exc:
        return response(503, {'error': 'solver_unavailable', 'solver_status': exc.status,
                              'message': 'No usable solution returned within the solver budget'})
    except Exception:
        # Detailed traces and request contents are never placed in responses.
        return response(500, {'error': 'compute_failed', 'message': 'Protection planning failed'})
