# Observed remaining work

| Priority | Work and user benefit | Acceptance | Dependencies |
|---|---|---|---|
| P2 | Measure network/load targets to understand operating capacity | Q-MENU, Q-QUEUE, Q-TRACKING measured under stated session/network conditions | Representative host and load harness |
| P2 | Validate with actual people so usability claims have evidence | Required 9/10 outcomes for both human targets | Participant recruitment |
| P2 | Verify hosted HTTPS and durable deployment | End-to-end HTTPS session and restart on chosen persistent host | Operator-provided hosting; outside local build |
| P2 | Expand browser and assistive-technology coverage | VoiceOver speech/focus and actual zoom checks on Safari/iOS; Firefox/Android core journeys pass | Actual devices/browser installs and assistive-technology session |
| P3 | Ease operator credential rotation without public registration | Local maintenance command changes one password and revokes its sessions without deleting orders | Current generated accounts; an operator script is currently required for rotation |

Customer/staff browser journeys and regression checks are implemented. No unresolved functional failure from the executed checks is intentionally accepted. Automated accessibility evidence does not establish human usability or universal assistive-technology support. Single-host SQLite and in-process sign-in throttling are deliberate local choices, not a multi-instance production-capacity guarantee.
