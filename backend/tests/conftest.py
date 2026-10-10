import pytest
from app.scenarios import sample


@pytest.fixture
def yard():
    return sample()


@pytest.fixture
def optimized(yard):
    from app.optimizer import optimize
    return optimize(yard)
