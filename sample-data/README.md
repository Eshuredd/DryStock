# Fictional Surat yard

`surat-yard.json` is a reproducible, fictional scenario for Bharat Builds Environmental Hacks, Waste & Energy track. It is not a survey of an actual yard and is not a live forecast.

- 12 lots: 11 exposed; L12 is already sheltered and consumes none of the demo's two *additional* covered positions.
- Three workers; Asha alone is certified for forklift operation. Every worker assigned to an action must have its listed skills.
- One forklift, two covered positions, three tarps. Compatibility uses material category and maximum lot weight. Weight is a demo proxy for tarp size and bay capacity; a production model needs geometry, volume, stacking and access clearance.
- Handling cutoff: minute 60; rain arrives at minute 70; safety buffer: 10 minutes. All times are integer offsets from a fictional event origin, independent of wall-clock time.
- Each tarp and bay protects one whole lot and remains allocated through the event. No split lots, shared bays, stacking, resource reuse or partial benefits from unfinished work.
- Protection effectiveness is an assumed percentage of operator-entered exposed loss: covers 75–95%, relocation 100%. These are not experimentally established estimates. Loss assumptions already represent the approaching weather event; vulnerability and exposure are descriptive inputs, not multiplied into the loss again.
- Money is integer INR. Benefit is `floor(exposed_loss × effectiveness_bps / 10,000)`. Covering can still leave residual loss.
- Required skills, duration, crew count, forklift, compatible tarp/bay and availability are machine-enforced restrictions. Free-text restrictions explain those fields; arbitrary prose is not parsed into constraints.

L05 deliberately has high value and a long handling time. The scenario demonstrates competition between protection quality, asset compatibility and worker availability. It is a demonstration fixture, not evidence that optimisation universally outperforms operators.

Reference result (OR-Tools 9.15.6755): CP-SAT avoids ₹35,809 of an assumed ₹54,230 exposed loss. The best greedy baseline avoids ₹35,550; the difference is ₹259 (0.73%). At shorter deadlines or after disruptions, the comparison changes. Equivalent schedules may exist; action and timing choices need not be identical across solver releases.
