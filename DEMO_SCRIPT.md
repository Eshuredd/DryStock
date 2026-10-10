# DryStock recording — target 2 minutes 50 seconds

Before recording: follow `sam/README.md`; build/invoke both events; start SAM API and the app in SAM mode with the isolated demo database. Reset that demo yard. Keep a terminal with the successful SAM output ready. Do not wait for an image build during the recording. Use a desktop viewport and readable zoom.

| Time | Screen and action | Narration |
|---|---|---|
| 0:00–0:20 | Original yard, weather window and resources | “DryStock helps a recycling-yard manager decide which vulnerable lots to protect before rain, with limited workers, tarps and covered space. This is fictional demonstration data.” |
| 0:20–0:40 | Generate; open Compare strategies | “The initial optimal plan addresses ₹35,809 of assumed loss. The strongest simple baseline reaches ₹35,550: only a 0.73% gain. We keep that modest result visible.” |
| 0:40–1:00 | Plan & timeline; approve; record L02 complete | “A manager approves the plan. We simulate L02’s scheduled completion at minute 12. Its ₹5,850 benefit and tarp T2 are retained. This is operator attestation, not physical verification.” |
| 1:00–1:25 | Trigger demo disruption; Generate plan | “Now rain arrives earlier, the cutoff becomes minute 35, and the forklift fails. The old approval is invalidated. Every unfinished action is reconsidered while completed protection stays allocated.” |
| 1:25–1:45 | Before/after table; open an action’s Handling inputs | “The revised plan reallocates crews and bays, schedules four new actions, and leaves six lots exposed. These reasons show the actual duration, risk and compatibility inputs. The independent validator checks the result.” |
| 1:45–2:05 | Compare strategies | “The revision addresses another ₹16,821 of modelled loss, versus ₹14,985 for the strongest baseline—a 12.25% gain. Completed benefit is reported separately.” |
| 2:05–2:30 | Terminal: successful SAM commands/logs; then UI provenance | “AWS SAM CLI built and invoked the real OR-Tools engine in a Linux Lambda-compatible image. Both historical outcomes match local execution. The application’s SAM mode calls that running SAM API and validates its actual response before saving. This runs locally; it is not cloud deployment.” |
| 2:30–2:50 | Benchmark report and metric labels | “Across 29 fixed scenarios, 14 improve and 15 tie; median gain is zero. Scheduled kilograms are not waste actually prevented. We need real-yard duration, damage and execution evidence before operational claims.” |

Show the exact `sam build`, `sam local invoke` and `sam local start-api` terminal evidence, not just an AWS logo. A fresh invocation can be recorded as a separate short clip before the walkthrough and inserted into the tool segment. Keep the combined final video below three minutes.

Submission work remaining: record/export the video, include the required event materials and links, and confirm the organiser’s current eligibility/submission rules. This project demonstrates the requested AWS SAM open-source pathway; no customer adoption, measured savings or real environmental impact is claimed.
