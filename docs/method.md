# Recording contract and detector behavior

Version 0.1.0 uses arrival-ordered rows, one numeric channel and a uint32 sequence counter. Both the browser and the Node tests import `web/analysis.mjs`.

## Sequence observations

Each contiguous boot segment starts at its first observed counter. Compare a counter to the highest observed extended position with modulo-2^32 arithmetic. A positive forward difference below 2^31 advances the high-water mark. Skipped positions form an ordered gap interval. A difference above 2^31 is treated as backward/out of order. Exactly 2^31 is ambiguous and rejected. This serial-number interpretation assumes no unmarked reset and no unobserved forward jump of 2^31 or more. The recording alone cannot resolve that ambiguity.

A first arrival of a lower position is out of order. If it belongs to an earlier gap interval, final absence decreases once and that event records recovery. A repeated position in the same boot is a duplicate, even when its numeric value differs. Such an arrival cannot fill a gap twice. A lower counter from before the first observed position is out of order but never creates negative absence or an inferred pre-capture gap.

A new `boot_id` starts a fresh sequence segment. Missing positions from earlier segments remain absent in the complete recording. The earlier boot ID cannot reappear later in the same file. Boot IDs are producer-supplied labels, not authenticated proof of reboot. No device identity, counter freshness or capture completeness is independently established.

The detector counts positions without allocating a missing-sample array. Seen received positions are stored in a Set. Ordered, non-overlapping forward gap intervals allow binary search for late recovery. Memory scales with received rows/events, including very large jumps in the counter domain.

## Timing observations

`received_ms` is collector arrival time, not a sensor value timestamp. It must be finite, nonnegative, no greater than 1e12, and nondecreasing. Equal timestamps are allowed. A pause is flagged only if the difference between two consecutive received rows is **strictly greater than expected interval × gap factor**. Defaults are 100 ms and 3. A changed interval recalculates all events; sequence gaps are independent.

A timing gap can coexist with a sequence jump, duplicate or boot change. One event groups observations at the same received row. A gap is never extrapolated past the recording's first/last arrival. The chart breaks its line across timing gaps and boot boundaries instead of drawing invented intermediate readings. It plots received values at arrival timestamps; it does not interpolate measurements inside the gap.

## Replay and reports

The full-file summary and event explanation use the entire file, including later recovery. The player uses only the prefix ending at the latest row reached by its cursor. Prefix counters are stored during analysis. Seek uses binary search; equal-timestamp rows have all arrived by that time. The current reading is retained between arrivals and labeled with its age. A stale replay indication describes the recording at the replay time, not a live device connection.

A JSON session contains the exact normalized rows, detector version, interval settings, name and a producer-declared origin label. On import, rows/settings are validated and findings are recalculated by the current detector. The UI labels it as imported; it does not trust the declared origin as proof. A SHA-256 of canonical normalized CSV identifies the input, not the producer. Text findings include input hash, rule settings, summary and event rows. They are observations, not automatic root-cause diagnoses.

Input limits: 20,000 rows, 2 MiB CSV and 8 MiB saved sessions. The larger session limit accommodates JSON field names/formatting for the maximum supported recording. CSV supports reordered known columns, quotes, CRLF, UTF-8 BOM and blank lines. Unknown columns are rejected so units, clocks and counters are not silently guessed.

## Capture lifecycle

The Python utility reads one bounded JSON line per sample and stamps it with its own monotonic clock, relative to the first accepted reading. Malformed and overlong records are skipped with diagnostic messages. Their sequence positions may later appear absent; the viewer cannot distinguish a discarded malformed frame from another missing cause. The utility flushes each accepted CSV row and never overwrites an existing output. stdin EOF, sample-count completion or interruption ends capture. The POSIX adapter has an idle timeout and preserves completed rows on errors; no silent automatic reconnect is claimed.

The serial adapter configures a selected local tty for raw data at the requested baud and restores its prior settings on close. macOS can independently set PENDIN, a transient pending-input state; the restoration test masks only that state bit and checks the rest of the tty attributes. Virtual serial coverage demonstrates framing and OS I/O. It does not verify electrical behavior, board reset behavior or physical sensor accuracy.
