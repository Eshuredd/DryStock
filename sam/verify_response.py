"""Check real SAM invocation output against local compute; never calls a fake transport."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.engine import ComputeRequest, ComputeResult, execute, verify_result


def modeled_outcomes(result):
    return {p.strategy: {'status': p.solver_status, 'additional_inr': p.planned_saved_inr,
        'completed_inr': p.completed_saved_inr, 'residual_inr': p.residual_loss_inr,
        'scheduled_lots': len(p.tasks), 'unprotected_lots': len(p.unprotected_lot_ids)}
        for p in [result.plan, *result.comparisons]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--event', required=True)
    parser.add_argument('--response', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--normalized-response')
    args = parser.parse_args()
    request = ComputeRequest.model_validate_json(Path(args.event).read_text(encoding='utf-8-sig'))
    text = Path(args.response).read_text(encoding='utf-8-sig')
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        # SAM --log-file captures the runtime report and JSON response together.
        candidates = []
        for line in text.splitlines():
            try:
                item = json.loads(line)
                if isinstance(item,dict) and 'statusCode' in item and 'body' in item:
                    candidates.append(item)
            except json.JSONDecodeError:
                continue
        if len(candidates) != 1:
            raise SystemExit('Expected exactly one Lambda proxy response in SAM runtime log')
        raw = candidates[0]
    if args.normalized_response:
        Path(args.normalized_response).write_text(json.dumps(raw,indent=2),encoding='utf-8')
    if 'statusCode' in raw:
        if raw['statusCode'] != 200:
            raise SystemExit('SAM did not return HTTP 200: ' + str(raw['statusCode']))
        raw = json.loads(raw['body'])
    sam_result = ComputeResult.model_validate(raw)
    if sam_result.execution_backend != 'sam':
        raise SystemExit('Response did not identify SAM execution')
    verify_result(request.scenario, sam_result)
    local = execute(request)
    matches = modeled_outcomes(local) == modeled_outcomes(sam_result)
    evidence = {'event': Path(args.event).name, 'outcomes_match': matches, 'local': modeled_outcomes(local),
                'sam': modeled_outcomes(sam_result), 'independent_validation': True,
                'local_runtime': local.runtime, 'sam_runtime': sam_result.runtime,
                'sam_solve_seconds': sam_result.plan.solve_seconds, 'scenario_sha256': sam_result.scenario_sha256}
    Path(args.output).write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence, indent=2))
    if not matches:
        raise SystemExit('Modelled outcomes differ; inspect solver status/budget. No equivalence claim made.')
