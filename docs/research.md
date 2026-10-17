# Why this project, and why this scope

Research checked October 16, 2026, after completing ReverseLab 0.5. This is a documentation and capability comparison, not a source audit or runtime comparison of the products below. It does not establish a novel market category or prove product demand.

## Existing tools checked

- [Serial Studio](https://github.com/Serial-Studio/Serial-Studio) already offers telemetry dashboards, live hardware connections, parsing and recording/replay capabilities across editions. Its breadth makes a broad clone a weak portfolio direction. Study its explicit data format and connection lifecycle; use it when the larger instrument environment fits the job.
- [PlotJuggler](https://github.com/PlotJuggler/PlotJuggler) is an extensible time-series visualization application for recorded and live data. It is a reference for synchronized inspection and established plotting needs.
- [Teleplot](https://github.com/nesnes/teleplot) supplies a small text telemetry protocol and a browser plotting interface. Its low-friction approach reinforces the need for one obvious first action.
- [Rerun](https://github.com/rerun-io/rerun) addresses multimodal robotics data logging and visualization. Adopting a large viewer would not itself establish original engineering in a one-channel recording inspector.
- [Foxglove Studio's repository](https://github.com/foxglove/studio) is currently an archived pointer to the maintained product and documentation. It was not treated as an available reusable implementation.
- [MDN's Web Serial reference](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) documents secure-context and browser-availability constraints. CSV import provides a usable browser-independent entry point; direct browser serial is deferred.

No upstream code or assets were copied. These are references and alternatives, not dependencies. The current app uses browser APIs and pure JavaScript; the capture utility uses the Python standard library.

## Decision

Continue the SignalForge direction identified in the October 13 roadmap, narrowed to **recording integrity inspection**. The first release serves an engineering student or developer checking a single sensor logger. Its input is an arrival-ordered recording with a sample counter. Its output is an event with the exact interval, sequence evidence and replayable context.

The implementation focuses on an avoidable interpretation error: a sequence jump is not necessarily permanent loss. A later arrival can fill it. Final absence, out-of-order arrivals, duplicate deliveries and timing gaps remain distinct observations. Sequence wrap and explicit reboot segments need defined behavior.

This is a fit judgment: it connects the portfolio's hardware and verification work while adding a file-based tool someone can try without installation or an AI account. ResolveAI addresses IT investigations; ReverseLab compares implementations; SignalForge inspects recording continuity. We do not claim it is better than established general-purpose telemetry tools. Its usefulness with real development workflows still needs feedback and physical-device trials.

## First release acceptance

- The first screen explains the task and displays a labeled example with directly inspectable evidence.
- User CSV data works, not only bundled examples.
- Imported content remains in the browser; errors retain the previous recording.
- A late arrival reduces final absence once; a duplicate cannot fill the same gap twice.
- Wraps and boot changes are distinct from missing positions.
- Replay prefix counters cannot use observations from the future.
- Session and CSV export reproduce exact rows and settings; findings are recomputed on reopen.
- Python framing and arrival timestamps work through actual stdin processes and a virtual serial device.
- A public HTTPS demo and source make the first release independently reviewable.

## Deferred, with a purpose

Physical-device capture is the next substantive validation step. Choose a board already available, document its packet schema and sample interval, record healthy and intentionally interrupted runs, and compare detector observations with the experiment log. Do not label simulated captures as hardware evidence. Multi-channel analysis and vendor adapters should follow a demonstrated need, rather than another dashboard expansion.
