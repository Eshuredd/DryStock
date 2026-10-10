# DryStock Phase 2 benchmark

Fictional modelled benefits, not measured financial or environmental savings. No fixture was retuned after outcomes.

29 fixed cases, 29 proven optimal, 0 feasible/unproven, 0 time-budget exits.

Mean gain: INR 1,089.34; median: INR 0.00. Best: INR 7,150.00; worst: INR 0.00.
Mean relative gain: 5.56%; median: 0.18% over 27 cases with nonzero baseline benefit.
Improvement in 48.28% of usable cases; ties in 51.72%; baseline better in 0 cases.

Percentages of improving/tied cases use usable cases as denominator. Zero-baseline relative gain is undefined (N/A), not 0%. Timeouts include UNKNOWN and feasible exits at the time budget; FEASIBLE remains a usable unproven incumbent.

## Fixed protocol

Generated seeds: [1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1109, 1110]. One second per solver, one worker, solver seed 7. All strategies receive identical complete scenarios and independently validated schedules. Actual elapsed times vary by machine.
Capacity zero means the corresponding resources are disabled. Resource utilisation reports new worker/equipment minutes; assets include completed work and are event-long allocations.

| Case | Status | CP-SAT INR | Best baseline INR | Gain INR | Relative gain | Scheduled lots | Exposed lots |
|---|---|---:|---:|---:|---:|---:|---:|
| historical-original | OPTIMAL | 35809 | 35550 | 259 | 0.73% | 5 | 6 |
| historical-disruption | OPTIMAL | 16821 | 14985 | 1836 | 12.25% | 4 | 6 |
| cutoff-0 | OPTIMAL | 0 | 0 | 0 | N/A | 0 | 11 |
| cutoff-10 | OPTIMAL | 9112 | 7575 | 1537 | 20.29% | 2 | 9 |
| cutoff-20 | OPTIMAL | 22345 | 18056 | 4289 | 23.75% | 4 | 7 |
| cutoff-35 | OPTIMAL | 31617 | 28005 | 3612 | 12.90% | 5 | 6 |
| cutoff-90 | OPTIMAL | 35959 | 35959 | 0 | 0.00% | 5 | 6 |
| cutoff-120 | OPTIMAL | 35959 | 35959 | 0 | 0.00% | 5 | 6 |
| workers-off-W1 | OPTIMAL | 27855 | 27855 | 0 | 0.00% | 5 | 6 |
| workers-off-W2 | OPTIMAL | 32119 | 28159 | 3960 | 14.06% | 5 | 6 |
| workers-off-W1-W2 | OPTIMAL | 14545 | 13984 | 561 | 4.01% | 3 | 8 |
| workers-off-W1-W2-W3 | OPTIMAL | 0 | 0 | 0 | N/A | 0 | 11 |
| forklift-off | OPTIMAL | 29009 | 27855 | 1154 | 4.14% | 5 | 6 |
| bay-capacity-0 | OPTIMAL | 21259 | 21259 | 0 | 0.00% | 3 | 8 |
| bay-capacity-300 | OPTIMAL | 29009 | 21859 | 7150 | 32.71% | 5 | 6 |
| bay-capacity-700 | OPTIMAL | 31617 | 27855 | 3762 | 13.51% | 5 | 6 |
| tarps-none | OPTIMAL | 17010 | 17010 | 0 | 0.00% | 2 | 9 |
| tarps-T3 | OPTIMAL | 22939 | 22680 | 259 | 1.14% | 3 | 8 |
| restricted-compatibility | OPTIMAL | 17075 | 17075 | 0 | 0.00% | 4 | 7 |
| generated-1101 | OPTIMAL | 27413 | 27364 | 49 | 0.18% | 4 | 7 |
| generated-1102 | OPTIMAL | 21906 | 21906 | 0 | 0.00% | 3 | 6 |
| generated-1103 | OPTIMAL | 20327 | 20327 | 0 | 0.00% | 4 | 7 |
| generated-1104 | OPTIMAL | 17414 | 17414 | 0 | 0.00% | 4 | 6 |
| generated-1105 | OPTIMAL | 6646 | 6646 | 0 | 0.00% | 3 | 5 |
| generated-1106 | OPTIMAL | 24242 | 23103 | 1139 | 4.93% | 4 | 7 |
| generated-1107 | OPTIMAL | 37951 | 35927 | 2024 | 5.63% | 5 | 6 |
| generated-1108 | OPTIMAL | 14352 | 14352 | 0 | 0.00% | 4 | 7 |
| generated-1109 | OPTIMAL | 2312 | 2312 | 0 | 0.00% | 1 | 7 |
| generated-1110 | OPTIMAL | 18413 | 18413 | 0 | 0.00% | 3 | 6 |

## Interpretation

The historical original case remains a small 0.73% improvement. The historical disruption retains L02 and tarp T2: its additional benefit improves by 12.25%. This distinguishes already-completed benefit from new planned benefit.
Larger observed gains arise where greedy early decisions use a scarce asset or worker interval that would serve a better combination of actions. These associations are inspectable in the JSON allocations; they are not causal proofs or guarantees for actual yards.
Ties show where a simple strategy provides equivalent modelled value. With no feasible handling window or no workers, every strategy correctly schedules nothing. A nonzero tie likewise provides no financial-model advantage for CP-SAT.
Generated scenarios are synthetic stress variations, not a representative industry sample. Means and medians describe only this predefined suite. No carbon, waste-prevention, adoption or measured savings claims follow.
