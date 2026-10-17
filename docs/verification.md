# First release verification — October 17, 2026

Status: v0.1 source and demo prepared for the public publication authorized by the owner on October 17. Hosted checks are recorded separately after upload.

Environment: macOS arm64, Node 24.19.0, Python 3.9.6, Chrome. No project runtime dependencies are installed. JavaScript analysis and CSV/session contract: 23 passing checks. Python framing, pseudo-terminal behavior and CLI processes: ten passing checks.

Browser observations:

- The missing-readings example reports 110 rows, ten absent sequence positions and one 1,100 ms pause. The chart visibly breaks through the pause and evidence names the surrounding arrival times/counters.
- The late example reports 121 rows, zero absent positions at the end, one recovered reading, one out-of-order arrival and one duplicate. Event replay includes the later recovery and reaches prefix counters with zero absence, one out-of-order arrival and one duplicate at 2.55 seconds.
- A clean capture has no flagged events and explicitly limits what that establishes.
- A real browser-selected CSV is parsed and recalculated. A file with backward arrival time is rejected with a data-row error; the previous recording remains visible.
- Actual browser downloads produce a JSON session, normalized CSV and findings text. The downloaded CSV and session contain exactly the same 121 input readings. Reopening the saved session labels it as imported and recalculates the findings.
- Complete-file findings and replay-prefix counters are visibly separated.
- The revised interface puts the signal timeline, playback and time-range controls first. Event isolation selects 3.70–5.30 seconds in the missing example. An actual browser export contains exactly seven original readings (sequences 37, 38, 39, 50, 51, 52, 53), with original 3700–5300 ms timestamps. Reopening it recalculates seven rows, ten missing positions and one timing gap.
- The earlier interface passed a 390px check. During the revised interface review the browser viewport override did not change the actual 1470px viewport; therefore a fresh mobile visual pass is not claimed here. Responsive styles stack the transport, range controls and event details below 700px.
- Browser console errors/warnings were empty during these checks.

The Python serial tests use an operating-system pseudo-terminal. The command-line integration sends a generated NDJSON producer through the actual capture process. These demonstrate framing, timestamping and file integrity with synthetic values. They do not establish any physical sensor's accuracy, electrical behavior or connection reliability.

No throughput or latency guarantee, user study, physical-device certification, security audit, or comparison benchmark against established tools is claimed. The next validation milestone is a documented capture from a real board with known interrupted/healthy intervals.
