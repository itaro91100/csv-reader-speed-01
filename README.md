# csv-reader-speed-01

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/itaro91100/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/itaro91100/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers exactly as csv-reader does on every case — broken quoting, stray CRs, multiline fields, short and long rows included — in roughly a third of the CPU time.

## Run locally

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

Or grade it on the kit's practice set (from the unpacked kit):

```sh
node cli/makefun.mjs grade-local --kit . --bot <repository> --driver process
```

## How it is faster

One left-to-right pass, no per-character loop on the hot path: clean unquoted fields are taken with two `indexOf` scans and one `slice`; quoted fields find their closing quote with `indexOf` and only fall back to a character loop when the content actually holds escapes, newlines or carriage returns. Line ends are cached once per record, and the output slots are reused instead of allocating a result object per field.

Measured on the kit's practice set (6 cases, ~10 MB) with the harness's own `--no-incremental-marking` flag, alternating baseline and entry in one process with a GC between rounds: entry ~250 ms vs csv-reader 1.0.0 ~800–1,260 ms, about 3–5x faster, with byte-identical answers on all 6 cases and on 4,000 randomly generated broken-CSV inputs.

Optional: earn referral rewards, a second way to make money — join with my referral link: https://make.fun/r/vg0kgv1n
