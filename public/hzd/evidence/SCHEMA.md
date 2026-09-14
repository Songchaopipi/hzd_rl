# Interactive Evidence Contract (Version 1)

All URLs are `/hzd/evidence/<name>.json`. These are read-only exports of saved
artifacts, not new training or robot rollouts. Array order is significant.
Every root has `schema_version: 1`, `metadata` (sources, units, definitions,
cohorts, limitations), and the fields below. Nonfinite measurements are `null`,
never zero. Numbers retain seven significant digits. Rates are fractions [0,1].

## Shared Types

```ts
type Band = {q25: (number|null)[]; median: (number|null)[];
             q75: (number|null)[]; n: number[]};
type Distribution = {n: number; missing: number; min: number|null;
  q25: number|null; median: number|null; q75: number|null;
  p95: number|null; max: number|null};
type Bins = {x: number[]; median: number[]; q25: number[];
             q75: number[]; n: number[]};
type Rate = {numerator: number; denominator: number; fraction: number|null};
```

## saturation.json

`models[]`: `{id, label, latent_dim, checkpoint, curve, radial_gain, calibration}`.

- `curve`: `{radius, physical_median, q25, median, q75, n}`. Radius is the
  prescribed normalized perturbation radius; plot `physical_median` on x and
  latent `median` on y. Quantiles are across matched perturbation samples.
- `radial_gain[]`: `{interval: [start,end], values, distribution}`. Values are
  signed per-sample secants divided by the median local 0.2-to-0.4 secant.
  Sample indices remain paired across the two intervals within a model.
- `calibration`: `{points: [physical,latent][], bins: Bins, spearman, n}`.
  Points retain saved stochastic-rollout order; they are control steps, not
  independent rollouts. Historical models differ in joints and training stage.

## tracking.json

`axes[]`: `{id: 'vx'|'vy'|'wz', label, unit}`.
`command_names` and `command_units` describe six-dimensional `commands[N][6]`.
`policies[]`: `{id, label, checkpoint, measured_steps, measured_seconds,
done_flags_in_measurement, actual_mean[N][3], full_time_rmse[N][3],
bins: Record<axis,Bins>, rmse_distribution: Record<axis,Distribution>}`.

Policy IDs: `teacher`, `orbit_only`, `orbit_tube`. Row index is the environment
and paired-condition ID in every policy array and `commands`. Keep the full
command vector when filtering or comparing. RMSE includes temporal variation
after the source's additional 100-step burn-in; it is not error of the mean.

## orbits.json

`dimensions[]`: `{latent_dim, checkpoint, checkpoint_step, seed_count,
burnin_cycles, center_command, phase, sweeps[]}`.
`sweeps[]`: `{id, label, unit, command_index, pca_explained_ratio, conditions[]}`.
`conditions[]`: `{value, command, group_labels, cycle_residuals, converged,
seed_spread, max_pairwise_distance, lines[], phase_distance: Band}`.
`lines[]`: `{seed, group, representative, converged, xy[phase.length][2]}`.

Sweeps: `vx`, `vy`, `wz`, `gait_period`, `swing_height`, `torso_height`.
Every saved medoid and every unresolved seed is included, never a seed-mean
orbit. All eight seeds contribute to phase-distance quantiles, using the same
seed and phase of the center command. The 128-point phase array is unclosed;
renderers may close a line for display but must not shift slider indexing.
PCA is separately fitted per dimension/sweep, not comparable across panels.
Group labels are local to a single condition, not tracked branches.

`offline_poincare`: `{available, sources, scope, sections[]}` when found.
Sections contain `{id, samples[]}`; samples contain `{command, fixed, measured}`,
each spectrum `{eigenvalues: [real,imag][], spectral_radius}`. Additional
saved per-command diagnostics are in `diagnostics`. These are learned offline
maps, not physical closed-loop eigenvalues.

## recovery.json

`phases`: `[0,0.25,0.5,0.75]`; `commands[]`: `{id, label, values[6]}`;
`push_groups`: `['Fx','Fy','Fz','Tx','Ty','Tz','random_6d','control']`;
`time_s[]`; `return_numbers`: `[1,2,3,4,5,6]`.

`policies[]`: `{id: 'teacher'|'tube', label, provenance, summary,
trial_columns, trials: (number|boolean|null)[][], cells[]}`.
Trial column order is self-described by `trial_columns`:
`id, phase, command, group, failed, excited, recovered, peak, threshold,
tail_p95, return_ratio_left, return_ratio_right, return6_left, return6_right`.
`group` is an index into root `push_groups`. IDs are phase-concatenated saved
trial indices, matched across policies after design validation. Trial scalars
retain the full tail/return distributions for exact interactive filtering.

`cells[]`: `{phase: number|'all', command: number|'all', group: string,
n_trials, n_survivors, physical: Band, transverse: Band,
physical_control_p95: (number|null)[], transverse_control_median: (number|null)[],
returns: {left: Band, right: Band, control_p95_left: (number|null)[],
control_p95_right: (number|null)[]}, strict_recovery: Rate,
strict_recovery_all_trials: Rate, failed: Rate,
tail_distribution: Distribution, return_ratio_distribution: Distribution,
sixth_return_distribution: Distribution}`.

For each policy, all combinations of phase (4 + `all`), command (4 + `all`),
and group (8 + `all`) are exported. `group: 'all'` means **forced only**,
never controls. `control` is separately selectable. Bands are recomputed from
pooled individual measurements for each cell. Never average cell medians or
IQRs. Control overlays use the same phase/command selection, irrespective of
the selected push group. Curve samples are decimated after metric calculation;
strict outcomes always use the full saved time grid.

Physical/transverse bands use nonfailed trials, ignoring missing samples per
time index and exposing `n`. Return bands use complete, nonfailed sequences
separately per foot. Strict-recovery denominator is excited trials including
failures; the explicit all-trial rate also includes unexcited trials. Missing
tails and failures never count as recovered. Return ratios require complete,
nonfailed sequences with first-return error >0.05. Feet are not independent
training replicates. Tail-distribution cells follow nonfailed trials; raw trial
rows retain failures/missing values for honest custom cohorts.

## Quantitative Limits

- Tracking yaw RMSE medians: teacher 0.3162, tube 0.3684 rad/s; tube does not
  improve every command axis. Orbit-only translation tracking is weak.
- Strict recovery: teacher 83.72%, tube 74.74%. At straight vx=0.8 m/s, tube
  is about 3.8% vs teacher 79.0%, despite both returning to the broad tube.
  Median tail physical error there is about 0.326 vs 0.0841. Matched-time error
  includes phase offset; this does not identify its physical cause.
- PCA crossings do not prove nonconvergence. 8D maximum seed spread is about
  3.35e-7; some higher-dimensional conditions have multiple numerical groups.
  Unresolved cycles are retained, and group labels do not prove attractors.
- IQRs describe samples, not confidence intervals over independent training
  seeds. Each policy/model uses one historical checkpoint.

## Export and Verification

From the workspace root, using the existing `g1_cp` environment:

```bash
python FADA-humanoid-main/scripts/export_evidence.py
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest tests/test_evidence_export.py -q
```

Disable plugin autoload to keep unrelated system ROS pytest plugins out of the
isolated data tests. Use `--only saturation tracking orbits` for the fast subset;
`--only recovery` exports the recovery file. Default invocation exports all four.

First export: saturation 81 KB, tracking 148 KB, orbits 1.37 MB, recovery 5.53 MB
(7.13 MB total, decimal units, uncompressed). Recovery retains 87 display time
samples from the full 331-sample grid; outcome calculations use all 331.
The 24D offline spectra are from
`hzd/runs/g1_23dof_dynamics_stage2/poincare_best_c64/`: 64 command samples for
each of two feet, including both measured-state and refined-fixed-point spectra.

Completed: contract, test-first adapters, and all four exports. The exporter
validates the full recovery summaries and paired designs before writing recovery.
