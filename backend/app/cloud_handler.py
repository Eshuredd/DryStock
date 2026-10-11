"""API Gateway HTTP API v2 handler. No FastAPI/SQLite import or filesystem state."""
import base64
import json
import os
import re
import boto3
from botocore.exceptions import ClientError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from .dynamo import DynamoStore, SessionExpired, RevisionConflict, QuotaExceeded
from .engine import ComputeRequest, execute, SolverUnavailable, InvalidResult
from .models import Plan
from .validator import validate_plan

_store = None


class Revision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    revision: int = Field(ge=0)


class Disruption(Revision):
    deadline: int = Field(ge=0, le=230)
    now_minute: int = Field(ge=0, le=230)
    disabled_workers: list[str] = Field(default_factory=list, max_length=6)
    forklift_enabled: bool = True


class PlanCheck(Revision):
    plan: Plan


def get_store():
    global _store
    if _store is None:
        table = os.environ.get('DRYSTOCK_TABLE')
        if not table:
            raise RuntimeError('Missing cloud table configuration')
        _store = DynamoStore(boto3.client('dynamodb'), table)
    return _store


def response(status, body, origin=''):
    headers = {'Content-Type': 'application/json', 'Cache-Control': 'no-store',
               'X-Content-Type-Options': 'nosniff'}
    if origin and origin == os.environ.get('DRYSTOCK_ORIGIN'):
        headers.update({'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'})
    if status == 429:
        headers['Retry-After'] = '60'
    return {'statusCode': status, 'headers': headers, 'body': '' if status == 204 else json.dumps(body)}


def handler(event, context):
    origin = ''
    try:
        headers = {k.lower(): v for k, v in (event.get('headers') or {}).items()}
        origin = headers.get('origin', '')
        allowed = os.environ.get('DRYSTOCK_ORIGIN', '')
        # CORS is not authentication. Bearer capabilities and quotas enforce access.
        if origin and origin != allowed:
            return response(403, {'detail': 'Origin is not allowed'})
        method = event['requestContext']['http']['method']
        path = event.get('rawPath', '')
        if method == 'OPTIONS' and path.startswith('/api/'):
            preflight = response(204, None, origin)
            preflight['headers'].update({
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '300',
            })
            return preflight
        raw = event.get('body') or ''
        if len(raw.encode()) > 32768:
            return response(413, {'detail': 'Request exceeds 32 KiB'}, origin)
        if event.get('isBase64Encoded'):
            raw = base64.b64decode(raw, validate=True).decode('utf-8')
        if len(raw.encode()) > 32768:
            return response(413, {'detail': 'Request exceeds 32 KiB'}, origin)
        body = json.loads(raw) if raw else {}
        if not isinstance(body, dict):
            raise ValueError('Expected a JSON object')
        if method == 'GET' and path == '/api/health':
            return response(200, {'status': 'ok', 'mode': 'simulated', 'compute_backend': 'aws',
                                  'persistence': 'dynamodb'}, origin)
        store = get_store()
        if method == 'POST' and path == '/api/sessions':
            if body:
                raise ValueError('Session creation accepts no custom scenario or data')
            return response(201, store.create_session(), origin)
        authorization = headers.get('authorization', '')
        token = authorization.removeprefix('Bearer ') if authorization.startswith('Bearer ') else ''
        loaded = store.load(token)
        if method == 'GET' and path == '/api/state':
            return response(200, loaded['state'], origin)
        if method == 'GET' and path == '/api/plans':
            return response(200, store.history(loaded), origin)
        if method != 'POST':
            return response(404, {'detail': 'Route not found'}, origin)
        if path == '/api/disruptions':
            request = Disruption.model_validate(body)
            return response(200, store.disrupt(loaded, **request.model_dump()), origin)
        if path == '/api/validate':
            request = PlanCheck.model_validate(body)
            s = store.check(loaded, request.revision)
            return response(200, validate_plan(s, request.plan).model_dump(), origin)
        request = Revision.model_validate(body)
        if path == '/api/plans':
            s = store.check(loaded, request.revision)
            if context and context.get_remaining_time_in_millis() < 8000:
                return response(503, {'detail': 'Insufficient execution time; retry'}, origin)
            store.compute_lease(loaded)
            try:
                result = execute(ComputeRequest(scenario=s, solver_seconds=5), backend='aws')
                # The response passes the same independent output check again before storage.
                result.runtime['aws_request_id'] = getattr(context, 'aws_request_id', 'local-emulator')
                result.runtime['aws_region'] = os.environ.get('AWS_REGION', 'local-emulator')
                return response(200, store.save_plan(loaded, request.revision, result), origin)
            finally:
                try:
                    store.release_lease(loaded)
                except Exception:
                    # A valid committed result remains successful; the lease expires in 35 seconds.
                    print(json.dumps({'event': 'lease_cleanup_failed'}))
        if path == '/api/reset':
            return response(200, store.reset(loaded, request.revision), origin)
        match = re.fullmatch(r'/api/plans/([a-f0-9]{12})/approve', path)
        if match:
            return response(200, store.approve(loaded, match[1], request.revision), origin)
        match = re.fullmatch(r'/api/plans/([a-f0-9]{12})/tasks/(L\d{2})/complete', path)
        if match:
            return response(200, store.complete(loaded, match[1], match[2], request.revision), origin)
        return response(404, {'detail': 'Route not found'}, origin)
    except SessionExpired:
        return response(401, {'detail': 'Demo session expired. Start a new fictional session.'}, origin)
    except RevisionConflict as exc:
        return response(409, {'detail': str(exc)}, origin)
    except QuotaExceeded as exc:
        return response(429, {'detail': str(exc)}, origin)
    except (ValidationError, ValueError, TypeError, KeyError):
        return response(422, {'detail': 'Invalid request or scenario change'}, origin)
    except (SolverUnavailable, InvalidResult):
        return response(503, {'detail': 'Optimisation unavailable; no new plan was saved'}, origin)
    except ClientError as exc:
        # Operation/code only; no response message, event, token, body or credential logging.
        print(json.dumps({'event': 'aws_operation_failed', 'operation': exc.operation_name,
                          'code': exc.response.get('Error', {}).get('Code', 'Unknown')}))
        return response(503, {'detail': 'Demo storage temporarily unavailable; retry later'}, origin)
    except Exception:
        # Do not log the event/body/Authorization, exception secrets or capability token.
        print(json.dumps({'event': 'unexpected_cloud_failure'}))
        return response(503, {'detail': 'Demo temporarily unavailable; retry later'}, origin)
