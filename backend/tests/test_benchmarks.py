import pytest
from benchmarks.suite import scenarios, SEEDS
from benchmarks.run import result_row, summary


def test_scenario_generation_is_deterministic():
    first = [(i,seed,s.model_dump()) for i,seed,s in scenarios()]
    assert first == [(i,seed,s.model_dump()) for i,seed,s in scenarios()]
    assert len({i for i,_,_ in first}) == len(first) == 29
    assert tuple(seed for _,seed,_ in first if seed is not None) == SEEDS


def test_historical_outcomes_and_repeatability():
    original, disruption = list(scenarios())[:2]
    for args, expected in [(original,259),(disruption,1836)]:
        a = result_row(*args)
        b = result_row(*args)
        assert a['gain_inr'] == expected
        assert a['relative_gain_pct'] == b['relative_gain_pct']
        assert a['scenario_sha256'] == b['scenario_sha256']
        assert a['strategies']['CP-SAT']['additional_avoided_loss_inr'] == b['strategies']['CP-SAT']['additional_avoided_loss_inr']
        assert all(p['validation']['valid'] for p in a['strategies'].values())


def test_summary_calculations_ties_zero_baseline_and_timeouts():
    rows = [{'usable':True,'gain_inr':10,'relative_gain_pct':10,'solver_status':'OPTIMAL','timeout':False},
            {'usable':True,'gain_inr':0,'relative_gain_pct':None,'solver_status':'OPTIMAL','timeout':False},
            {'usable':True,'gain_inr':-1,'relative_gain_pct':-1,'solver_status':'FEASIBLE','timeout':True},
            {'usable':False,'solver_status':'UNKNOWN','timeout':True}]
    stats = summary(rows)
    assert stats['mean_gain_inr'] == 3
    assert stats['median_gain_inr'] == 0
    assert stats['mean_relative_gain_pct'] == 4.5
    assert stats['relative_defined_count'] == 2
    assert stats['improvement_pct'] == pytest.approx(100/3)
    assert stats['tie_pct'] == pytest.approx(100/3)
    assert stats['baseline_better_count'] == 1
    assert stats['timeouts'] == 2
