# Loading performance

How the dashboard loads, where the time went on 20 Oct 2026, what has been done about it, and the one
change that is left and is not HALO's to make. Every number below comes from
`node scripts/measure-load.mjs`, which prints them again, so a claim here can be re-checked rather than trusted.

## The rule

**Measure first.** An earlier "optimisation" here made a page slower and looked like a win until it was timed end to end.
`/api/metrics` (in-process, per operation) says what a request spent its time on; `scripts/measure-load.mjs` says what the
dashboard as a whole does and splits the slow part by service.

## Where the time went

| Step | Before | Now |
| --- | ---: | ---: |
| **Page, first byte** (what "upfront loading" means) | **3.6–4.0 s** | **0.06–0.13 s** |
| of which: configs, field specs, group names, session | ~0.12 s | ~0.12 s |
| of which: the readings-age health | **3.6 s** | — (loaded after paint) |
| Health, loaded after paint | — | 3 s cold, 15 ms from cache |
| History strips, loaded after paint | 8 s | 8 s cold, 20 ms from cache |

The page was waiting for a signal the cards do not need to be useful. Of a 3.7 s server render, 3.6 s was one read: a newest-row
query for each of 63 active Noise and WBGT projects. Configuration, field specs, group names and the session together were
about 120 ms. So the health now loads **after** first paint, from `/api/data-health`, concurrently with the strips, and the page
no longer awaits it. `tests/data-health-ui-contract.test.ts` asserts the page does *not* read it, as firmly as it once asserted
that it did: reading it there again brings the wait back.

It is held for a minute (`healthCache`), shared by everyone who asks, and forced fresh by *Refresh health*.

### What is not a problem

- **Document size.** The page is 966 KB uncompressed and **83 KB over the wire**. The configuration rows (270 KB) and field specs (119 KB)
  look large and compress to almost nothing. Not worth a lazy-loading rewrite.
- **The readings tables.** The newest-row query on one project's own table takes 0.08–0.29 s, even on a 112,000-row table. The health
  read is slow because 63 of them run together and contend for the database's connections, not because any one is slow.

## What is left, and whose it is

**History strips: 8 s cold, of which Noise is 4.0 s and WBGT 3.0 s.** Each service is read in pages of 1000 rows, and each page costs about a
second. That is not the rows or the network:

```
newest 1 row, ordered by started_at            1066 ms
1000 rows, NOT ordered                           92 ms
1000 rows, ordered by started_at               1160 ms
```

The same table, the same rows: ordering by `started_at` costs twelve times more, and costs the same for one row as for a thousand. That is
a sort of the whole run log on every request, which means there is **no index on `started_at`**. Ordering by any other column does not help:
`id` is a random UUID, so it is not a time order. This is the service's table and the service's migration, so the change is two statements:

```sql
create index if not exists noise_job_runs_started_at_idx
  on "noise-meters".noise_job_runs (started_at desc);

create index if not exists wbgt_job_runs_started_at_idx
  on wbgts.wbgt_job_runs (started_at desc);
```

Plain `create index`, not `concurrently`: the Supabase SQL editor runs in a transaction, where `concurrently` is refused, and these tables are
tens of thousands of rows, so the build takes moments. Writes to the table wait for that moment.

Expected effect, from the unordered timing above: Noise 4.0 s → under half a second, WBGT 3.0 s → about the same, and the cold history load
from about 8 s to about 1.5 s. **This is an estimate, not a result** — run `node scripts/measure-load.mjs` after applying it and section 3 and 4
say what actually happened. The other run logs (Issue Chaser 0.45 s, Haze 0.43 s) are not worth indexing for this.

Each service's own `supabase/setup.sql` should carry the same statement, so a new environment does not lose it; that is a change in each
service repository.

## Next iterations, in order of value

1. **Apply the index** (above). By far the largest remaining cost.
2. **Single-flight.** Two requests for the strips at the same moment each repeat the whole 8 s read. Share the in-flight promise.
3. **Stale-while-revalidate.** After the five-minute window expires, the next visitor waits the full cold read. Serving the last answer
   immediately (with its time, which the load stamps now show) and refreshing behind it would make every visit after the first instant.
4. **Fewer, larger health reads.** 63 queries is the floor while each project has its own table; only a database-side view or function
   could fold them into one.

## What the load stamps show

The header and the Data Health board list what has loaded, when it finished and how long it took, to the second, in Singapore time:

```
configs 19:20:43 · 611 ms   health 19:20:47 · 2.9 s   history 19:20:45 · 660 ms
```

`configs` arrives with the page (its duration is the server's render time); `health` and `history` arrive after it and say `loading…` until they
do, or `failed` if they could not, in which case what was on screen is left alone. *Refresh health* replaces the last two together.
