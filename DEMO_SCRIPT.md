# DryStock recording — target 2 minutes 50 seconds

**Phase 3 note:** the public AWS deployment is paused pending authorised access. The following existing Build It walkthrough remains reproducible. The cloud walkthrough at the end must only be recorded after actual deployment and live verification; there is no public URL yet.

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

## Ship It walkthrough — use only after verified deployment, target 2:50

Before recording, open the actual `WebsiteUrl` from stack outputs in a fresh tab. Run `sam/cloud_smoke.py` against the actual endpoints and separately verify the public browser workflow and visitor isolation. Keep the CloudFormation outputs and matching Lambda invocation logs ready. Do not show tokens, credentials or unrelated account screens.

| Time | Screen/action | Key message |
|---|---|---|
| 0:00–0:20 | Actual public HTTPS URL, fictional yard | Recycling-yard manager protects vulnerable material before rain with scarce handling resources. AWS-hosted demonstration; simulated inputs. |
| 0:20–0:40 | Generate and compare original | Actual Lambda CP-SAT: ₹35,809 versus best greedy ₹35,550; show the modest 0.73% gain honestly. |
| 0:40–1:00 | Approve and record L02 complete | Manager gate and simulated completion; minute 12, ₹5,850 benefit, tarp T2 retained. |
| 1:00–1:25 | Trigger disruption and regenerate | Earlier cutoff 35 and unavailable forklift; old approval invalidated; completed resources preserved. |
| 1:25–1:45 | Before/after and handling-input details | Four new actions, resource reallocation and exposed lots; independent validation and actual constraint inputs. |
| 1:45–2:05 | Revised comparison | ₹16,821 additional benefit versus ₹14,985 strongest baseline; 12.25% modelled gain. |
| 2:05–2:30 | Reload; second fresh session; architecture/log evidence | DynamoDB persists one visitor's state; second visitor remains separate. Show actual Lambda invocation ID matched to logs and deployed stack outputs. |
| 2:30–2:50 | Benchmark/metric labels | 29 fixed scenarios, 14 improvements and 15 ties; median gain zero. No measured savings, waste prevention or physical execution claims. |

Static screenshots, local SAM output or an “AWS” label are insufficient cloud proof. Use the real public URL and actual deployed invocation evidence. Replace no figures with hardcoded responses and keep the final edited recording below three minutes.
