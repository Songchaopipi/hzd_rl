#!/usr/bin/env python3
"""Export saved HZD evidence for native charts; never run models or simulators.

Run with the existing g1_cp Python environment. See public/hzd/evidence/SCHEMA.md.
Only the output directory is written. Metric definitions come from the original
analysis modules; no checkpoint is loaded and no trajectory is regenerated.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys
import warnings

import numpy as np
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from hzd.learning import plot_web_orbit_evidence as evidence
from hzd.learning.closed_loop_stability import plot_web_recovery as recovery


OUTPUT = ROOT / "FADA-humanoid-main/public/hzd/evidence"
RUNS = ROOT / "hzd/runs/web_orbit_evidence"
POINCARE = ROOT / "hzd/runs/g1_23dof_dynamics_stage2/poincare_best_c64"
COMMAND_NAMES = ("vx", "vy", "wz", "gait_period", "swing_height", "torso_height")
COMMAND_UNITS = ("m/s", "m/s", "rad/s", "s", "m", "m")
GROUPS = (*recovery.GROUPS, "control")
TRIAL_COLUMNS = ("id", "phase", "command", "group", "failed", "excited", "recovered",
                 "peak", "threshold", "tail_p95", "return_ratio_left",
                 "return_ratio_right", "return6_left", "return6_right")
COMMON_LIMITATIONS = [
    "Descriptive sample IQRs, not training-seed confidence intervals.",
    "One historical checkpoint per policy/model; no new training or physical rollouts.",
]


def portable_path(path):
    path = Path(path)
    if not path.is_absolute():
        return path.as_posix()
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return path.name


def json_ready(value):
    if isinstance(value, np.ndarray):
        return json_ready(value.tolist())
    if isinstance(value, np.generic):
        return json_ready(value.item())
    if isinstance(value, Path):
        return portable_path(value)
    if isinstance(value, bytes):
        return json_ready(value.decode("utf-8"))
    if isinstance(value, float):
        return float(format(value, ".7g")) if np.isfinite(value) else None
    if isinstance(value, str):
        return portable_path(value) if value.startswith("/") else value
    if isinstance(value, dict):
        return {str(json_ready(k)): json_ready(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_ready(v) for v in value]
    return value


def write_json(path, payload):
    text = json.dumps(json_ready(payload), ensure_ascii=True, allow_nan=False,
                      separators=(",", ":")) + "\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(path)


def source_info(path):
    path = Path(path)
    return {"path": portable_path(path), "bytes": path.stat().st_size}


def metadata(sources, units, definitions, cohorts, limitations):
    return {"sources": [source_info(p) for p in sources], "units": units,
            "definitions": definitions, "cohorts": cohorts,
            "limitations": COMMON_LIMITATIONS + limitations,
            "serialization": {"significant_digits": 7, "nonfinite": "null",
                              "paths": "workspace-relative; sources are not web URLs"}}


def nan_quantile(values, quantile):
    values = np.asarray(values, dtype=float)
    if not len(values):
        return np.full((len(quantile), *values.shape[1:]), np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanquantile(np.where(np.isfinite(values), values, np.nan), quantile, axis=0)


def band(values):
    values = np.asarray(values)
    low, median, high = nan_quantile(values, [.25, .5, .75])
    return {"q25": low, "median": median, "q75": high,
            "n": np.isfinite(values).sum(axis=0)}


def distribution(values):
    values = np.asarray(values).ravel()
    finite = values[np.isfinite(values)]
    result = {"n": len(finite), "missing": len(values) - len(finite)}
    names = ("min", "q25", "median", "q75", "p95", "max")
    quantiles = np.quantile(finite, [0, .25, .5, .75, .95, 1]) if len(finite) else [None] * 6
    return {**result, **dict(zip(names, quantiles, strict=True))}


def bins(x, y, count):
    original = evidence.binned_response(x, y, bins=count)
    return {"x": original["x"], "median": original["median"], "q25": original["low"],
            "q75": original["high"], "n": original["count"]}


def rate(outcomes, selected):
    numerator = int(np.count_nonzero(outcomes & selected))
    denominator = int(np.count_nonzero(selected))
    return {"numerator": numerator, "denominator": denominator,
            "fraction": numerator / denominator if denominator else None}


def build_saturation(source):
    source = Path(source)
    saved = json.loads((source / "summary.json").read_text())
    models = []
    with np.load(source / "raw_distances.npz", allow_pickle=False) as raw:
        for key, label, _ in evidence.MODELS:
            physical = raw[f"{key}/all_physical/physical_to_h_all"]
            latent = raw[f"{key}/all_physical/orbit_latent_distance"]
            if not np.isfinite(physical).all() or not np.isfinite(latent).all():
                raise ValueError("Nonfinite saturation samples")
            gain = evidence.relative_radial_gain(raw["radii"], physical, latent)
            px = raw[f"{key}/stochastic_rollout/physical_normalized_rmse"]
            zy = raw[f"{key}/stochastic_rollout/latent_rmse"]
            model_meta = saved["models"][key]
            models.append({
                "id": key, "label": label, "latent_dim": model_meta["latent_dim"],
                "checkpoint": model_meta["checkpoint"],
                "curve": {"radius": raw["radii"], "physical_median": np.median(physical, axis=0),
                          **band(latent)},
                "radial_gain": [{"interval": interval, "values": gain[:, i],
                                 "distribution": distribution(gain[:, i])}
                                for i, interval in enumerate(((2, 3), (3, 4)))],
                "calibration": {"points": np.column_stack((px, zy)), "bins": bins(px, zy, 7),
                                "spearman": float(spearmanr(px, zy).statistic), "n": len(px)},
            })
    return {"schema_version": 1, "models": models, "metadata": metadata(
        [source / "raw_distances.npz", source / "summary.json", Path(evidence.__file__)],
        {"radius": "RMS in checkpoint-normalized state coordinates", "physical": "normalized RMSE",
         "latent": "latent RMSE", "radial_gain": "fraction of local sensitivity"},
        {"curve": "Latent median/IQR over all_physical samples at each radius; x is physical median.",
         "gain": "relative_radial_gain: signed paired far-field secants / median local 0.2-to-0.4 secant.",
         "calibration": "Saved stochastic-rollout control steps; equal-width seven-bin median/IQR."},
        {"perturbation": "Paired sample rows across radius within each model; phase held fixed.",
         "calibration": saved.get("stochastic_rollout", {})},
        ["Historical 12-joint Stage3 / 16D versus 23-joint Stage2 / 24D; not a latent-width-only ablation.",
         "Both flatten: remaining 3-to-4 radial sensitivity is about 8.4% / 8.8%.",
         "Stochastic control steps are temporally dependent, not independent episodes."]) }


def build_tracking(source, burn_in=100):
    loaded = evidence.load_tracking(Path(source), burn_in)
    policies = []
    for key, label, _ in evidence.POLICIES:
        data = loaded[key]
        policies.append({
            "id": key, "label": label, "checkpoint": data["meta"]["checkpoint"],
            "measured_steps": data["steps"],
            "measured_seconds": data["steps"] * data["meta"]["control_dt"],
            "done_flags_in_measurement": data["done_count"],
            "actual_mean": data["actual"], "full_time_rmse": data["rmse"],
            "bins": {axis: bins(data["commands"][:, i], data["actual"][:, i], 10)
                     for i, axis in enumerate(COMMAND_NAMES[:3])},
            "rmse_distribution": {axis: distribution(data["rmse"][:, i])
                                  for i, axis in enumerate(COMMAND_NAMES[:3])},
        })
    return {"schema_version": 1,
            "axes": [{"id": name, "label": label, "unit": unit}
                     for name, label, unit in zip(COMMAND_NAMES[:3],
                         ("Forward velocity", "Lateral velocity", "Yaw rate"), COMMAND_UNITS[:3])],
            "command_names": COMMAND_NAMES, "command_units": COMMAND_UNITS,
            "commands": loaded["teacher"]["commands"], "policies": policies,
            "metadata": metadata(
                [Path(data["path"]) for data in loaded.values()] + [Path(evidence.__file__)],
                {"vx": "m/s", "vy": "m/s", "wz": "rad/s"},
                {"actual_mean": "velocity_metrics: time-mean body vx/vy and body angular wz.",
                 "full_time_rmse": "sqrt(mean_time((actual-command)^2)), including temporal variation.",
                 "pairing": "Row index is the same environment/complete command condition across policies.",
                 "additional_burn_in_steps": burn_in},
                {key: {"metadata": data["meta"], "environments": len(data["commands"])}
                 for key, data in loaded.items()},
                ["Tube yaw remains weaker: median RMSE 0.3684 vs teacher 0.3162 rad/s.",
                 "Orbit-only translation response is weak; Tube is not superior on all command axes.",
                 "One fixed mixed-command evaluation, not independently trained replications."])}


def build_poincare(source):
    source = Path(source)
    paths = [source / name for name in ("eigenvalues.npz", "spectral_radius.csv", "summary.json")]
    scope = ("Saved 24D learned contact-preimpact same-foot maps: measured latent and refined fixed point. "
             "Not physical Policy-MuJoCo closed-loop eigenvalues; fixed-point contraction does not prove "
             "contact invariance or contraction everywhere on measured states.")
    if not all(path.exists() for path in paths):
        return {"available": False, "sources": [portable_path(p) for p in paths],
                "scope": scope, "sections": []}
    with paths[1].open(newline="") as stream:
        rows = list(csv.DictReader(stream))
    summary = json.loads(paths[2].read_text())
    if summary["jacobian_dim"] != 24:
        raise ValueError("Expected the saved 24D learned Poincare analysis")
    sections = []
    with np.load(paths[0], allow_pickle=False) as raw:
        for section in dict.fromkeys(row["section"] for row in rows):
            selected = [row for row in rows if row["section"] == section]
            if len(selected) != len(raw[f"fixed_eigenvalues_{section}"]):
                raise ValueError("Poincare table/spectrum row counts disagree")
            samples = []
            for i, row in enumerate(selected):
                sample = {"command": [float(row[name]) for name in COMMAND_NAMES[:4]] + [None, None],
                          "diagnostics": {key: float(value) for key, value in row.items() if key != "section"}}
                for name, prefix in (("fixed", "fixed"), ("measured", "data")):
                    eigenvalues = raw[f"{prefix}_eigenvalues_{section}"][i]
                    radius = float(raw[f"{prefix}_spectral_radius_{section}"][i])
                    if not np.isclose(radius, float(row[f"{prefix}_spectral_radius"]), rtol=1e-6):
                        raise ValueError("Poincare table/spectrum sample order disagrees")
                    sample[name] = {"eigenvalues": np.column_stack((eigenvalues.real, eigenvalues.imag)),
                                    "spectral_radius": radius}
                samples.append(sample)
            sections.append({"id": section, "samples": samples})
    return {"available": True, "sources": [source_info(p) for p in paths], "scope": scope,
            "summary": summary, "sections": sections, "command_names": COMMAND_NAMES,
            "missing_command_fields": ["swing_height", "torso_height"],
            "limitations": ["CSV saves only vx/vy/wz/T; swing and torso command entries are null.",
                            "All 128 fixed-point spectra have radius <1 (max 0.9112); measured-state max "
                            "is 1.1485, with 96.875% <1. These are different evaluation points."]}


def build_orbits(source, poincare_source=POINCARE):
    from hzd.learning import plot_web_orbit_families as families

    source = Path(source)
    dimensions, sources, cohorts = [], [], {}
    for dimension in families.DIMENSIONS:
        raw_path = source / f"latent{dimension}_raw.npz"
        meta_path = source / f"latent{dimension}_metadata.json"
        saved = json.loads(meta_path.read_text())
        sources.extend((raw_path, meta_path))
        cohorts[str(dimension)] = {key: saved[key] for key in (
            "checkpoint", "checkpoint_step", "seed_count", "burnin_cycles", "cycle_tolerance",
            "group_tolerance", "seed_provenance", "dataset", "input_sha256")}
        sweeps = []
        with np.load(raw_path, allow_pickle=False) as raw:
            center = raw["center_command"]
            for j, name in enumerate(COMMAND_NAMES):
                orbits = raw[f"{name}_seed_orbits"]
                distance = families.paired_phase_distances(orbits, raw["center_seed_orbits"])
                if not np.allclose(distance, raw[f"{name}_phase_distances"], rtol=1e-7, atol=1e-12):
                    raise ValueError("Saved paired phase distances disagree with source definition")
                projected = raw[f"{name}_pca_projected"]
                representatives = raw[f"{name}_representative_mask"]
                converged = raw[f"{name}_converged"]
                labels = raw[f"{name}_group_labels"]
                conditions = []
                for i, value in enumerate(raw[f"{name}_values"]):
                    command = center.copy()
                    command[j] = value
                    diagnostics = saved["parameters"][name]["points"][i]
                    lines = [{"seed": int(seed), "group": int(labels[i, seed]),
                              "representative": bool(representatives[i, seed]),
                              "converged": bool(converged[i, seed]), "xy": projected[i, seed]}
                             for seed in np.flatnonzero(representatives[i] | ~converged[i])]
                    conditions.append({
                        "value": value, "command": command, "group_labels": labels[i],
                        "cycle_residuals": raw[f"{name}_cycle_residuals"][i], "converged": converged[i],
                        "seed_spread": diagnostics["seed_spread"],
                        "max_pairwise_distance": diagnostics["max_pairwise_distance"],
                        "lines": lines, "phase_distance": band(distance[i]),
                    })
                sweeps.append({"id": name, "label": families.TITLES[j], "unit": families.UNITS[j],
                               "command_index": j, "pca_explained_ratio": raw[f"{name}_pca_explained_ratio"],
                               "conditions": conditions})
            dimensions.append({"latent_dim": dimension, "checkpoint": saved["checkpoint"],
                               "checkpoint_step": saved["checkpoint_step"], "seed_count": saved["seed_count"],
                               "burnin_cycles": saved["burnin_cycles"], "center_command": center,
                               "phase": raw["phase_grid"], "sweeps": sweeps})
    return {"schema_version": 1, "dimensions": dimensions, "offline_poincare": build_poincare(poincare_source),
            "metadata": metadata(sources + [Path(families.__file__)],
                {"phase": "cycle fraction", "xy": "per-panel PCA latent coordinates",
                 "phase_distance": "latent-coordinate RMS", "cycle_residuals": "latent-coordinate RMS"},
                {"lines": "Saved PCA projections of actual medoid seeds plus every unresolved seed; never seed means.",
                 "pca": "Saved independent per-dimension/per-sweep PCA fitted to all values/seeds/phases.",
                 "phase_distance": "paired_phase_distances: RMS(command seed - center same seed) at each phase.",
                 "groups": "Saved complete-link groups at tolerance 0.01; labels local to a condition."},
                cohorts,
                ["PCA crossings are not proof of nonconvergence; 8D maximum seed spread is about 3.35e-7.",
                 "Some 16D/20D vx=1.6 and 24D swing/torso conditions have multiple numerical groups, not proven attractors.",
                 "20D swing residual reaches about 0.00247; numerical grouping does not certify a periodic attractor.",
                 "Nonrepresentative converged seeds are omitted from lines, but all eight enter distance quantiles and diagnostics.",
                 "Center same-seed distances vanish by construction even if center seeds disagree.",
                 "PCA planes and latent RMS scales are not calibrated across dimensions; these are not robot trajectories."])}


def time_indices(time, stride=4):
    if stride < 1:
        raise ValueError("Time stride must be positive")
    boundaries = [0., .1, 1., time[-1] - 1.]
    return np.unique(np.r_[np.arange(0, len(time), stride), len(time) - 1,
                            [np.argmin(np.abs(time - t)) for t in boundaries]])


def recovery_cells(data, indices):
    cells = []
    for phase in ("all", *np.unique(data["phase"])):
        phase_mask = np.ones(len(data["failed"]), dtype=bool) if phase == "all" else data["phase"] == phase
        for command in ("all", *np.unique(data["commands"])):
            matched = phase_mask & (True if command == "all" else data["commands"] == command)
            controls = matched & ~data["forced"]
            control_physical = nan_quantile(data["error"][controls][:, indices], [.95])[0]
            control_transverse = nan_quantile(data["tube"][controls][:, indices], [.5])[0]
            control_returns = nan_quantile(data["returns"][controls], [.95])[0]
            for group in ("all", *GROUPS):
                selected = matched & (data["forced"] if group == "all" else data["groups"] == group)
                survivors = selected & ~data["failed"]
                excited = selected & data["excited"]
                valid = selected[:, None] & data["return_valid"]
                ratios = data["return_ratio"][selected[:, None] & data["return_excited"]]
                cells.append({
                    "phase": phase, "command": command, "group": group,
                    "n_trials": int(selected.sum()), "n_survivors": int(survivors.sum()),
                    "physical": band(data["error"][survivors][:, indices]),
                    "transverse": band(data["tube"][survivors][:, indices]),
                    "physical_control_p95": control_physical,
                    "transverse_control_median": control_transverse,
                    "returns": {"left": band(data["returns"][valid[:, 0], 0]),
                                "right": band(data["returns"][valid[:, 1], 1]),
                                "control_p95_left": control_returns[0], "control_p95_right": control_returns[1]},
                    "strict_recovery": rate(data["recovered"], excited),
                    "strict_recovery_all_trials": rate(data["recovered"], selected),
                    "failed": rate(data["failed"], selected),
                    "tail_distribution": distribution(data["tail_p95"][survivors]),
                    "return_ratio_distribution": distribution(ratios),
                    "sixth_return_distribution": distribution(data["returns"][:, :, -1][valid]),
                })
    return cells


def recovery_design(directory):
    design, provenance = [], []
    shared_time, command_values, weights = None, None, None
    keys = ("commands", "command_ids", "condition_ids", "condition_labels", "condition_groups",
            "wrench_requested", "relative_time_s", "reconstruction_metric")
    for folder in sorted(Path(directory).glob("phase_*")):
        meta = json.loads((folder / "summary.json").read_text())
        with np.load(folder / "closed_loop_rollouts.npz", allow_pickle=False) as raw:
            block = {key: raw[key] for key in keys}
            time = block["relative_time_s"]
            values = np.asarray(meta["commands"])
            if shared_time is not None:
                if not np.array_equal(shared_time, time) or not np.array_equal(command_values, values):
                    raise ValueError("Recovery phase runs have different time grids or command vectors")
                if not np.array_equal(weights, block["reconstruction_metric"]):
                    raise ValueError("Recovery phase runs have different reconstruction weights")
            if not np.array_equal(block["commands"], values[block["command_ids"]]):
                raise ValueError("Recovery command IDs do not match saved vectors")
            shared_time, command_values, weights = time, values, block["reconstruction_metric"]
            block["phase"] = meta["push_phase"]
            design.append(block)
        provenance.append({key: meta[key] for key in (
            "policy_checkpoint", "latent_checkpoint", "push_phase", "num_envs", "push_duration_s",
            "wrench_frame", "wrench_body", "policy_stochastic", "nominal_physics",
            "return_cycles", "min_return_period_fraction", "minimum_airborne_samples_before_return")})
    if not design:
        raise ValueError(f"No recovery phase data in {directory}")
    return design, provenance, command_values


def check_recovery_pairing(first, second):
    if len(first) != len(second):
        raise ValueError("Recovery policy phase counts disagree")
    for left, right in zip(first, second, strict=True):
        for key in left:
            if not np.array_equal(left[key], right[key]):
                raise ValueError(f"Recovery paired designs disagree: {key}")


def check_summary(actual, saved, path="summary"):
    if isinstance(saved, dict):
        for key, value in saved.items():
            if key != "provenance":
                check_summary(actual[key], value, f"{path}.{key}")
    elif saved is None:
        if actual is not None:
            raise ValueError(f"Source summary mismatch: {path}")
    elif isinstance(saved, (float, int)):
        if not np.isclose(actual, saved, rtol=1e-6, atol=1e-9):
            raise ValueError(f"Source summary mismatch: {path}")
    elif actual != saved:
        raise ValueError(f"Source summary mismatch: {path}")


def build_recovery(source, stride=4):
    source = Path(source)
    saved = json.loads((source / "empirical_summary.json").read_text())
    sources = [source / "empirical_summary.json", Path(recovery.__file__)]
    policies, reference_design = [], None
    for key, label in recovery.LABELS.items():
        design, provenance, commands = recovery_design(source / key)
        if reference_design is not None:
            check_recovery_pairing(reference_design, design)
        else:
            reference_design = design
        data = recovery.load_policy(source / key)
        summary = recovery.summary_for(data)
        check_summary(summary, saved[key], key)
        indices = time_indices(data["time"], stride)
        trials = []
        for i in range(len(data["failed"])):
            trials.append([i, data["phase"][i], data["commands"][i], GROUPS.index(data["groups"][i]),
                           bool(data["failed"][i]), bool(data["excited"][i]), bool(data["recovered"][i]),
                           data["peak"][i], data["threshold"][i], data["tail_p95"][i],
                           *data["return_ratio"][i],
                           *np.where(data["return_valid"][i], data["returns"][i, :, -1], np.nan)])
        policies.append({"id": key, "label": label, "provenance": provenance, "summary": summary,
                         "trial_columns": TRIAL_COLUMNS, "trials": trials,
                         "cells": recovery_cells(data, indices)})
        for folder in sorted((source / key).glob("phase_*")):
            sources.extend((folder / "closed_loop_rollouts.npz", folder / "summary.json"))
    labels = ("Straight 0.4", "Straight 0.8", "Turn +0.5", "Turn -0.5")
    return {"schema_version": 1, "phases": np.unique(data["phase"]), "push_groups": GROUPS,
            "command_names": COMMAND_NAMES, "command_units": COMMAND_UNITS,
            "commands": [{"id": i, "label": labels[i], "values": value} for i, value in enumerate(commands)],
            "time_s": data["time"][indices], "return_numbers": list(range(1, 7)), "policies": policies,
            "metadata": metadata(sources,
                {"physical": "weighted normalized 52D physical-state RMSE", "transverse": "weighted decoded transverse distance",
                 "returns": "weighted normalized 52D section-state RMSE", "time_s": "seconds from push onset",
                 "force": "N (body frame)", "torque": "N m (body frame)", "rates": "fraction"},
                {**saved["definitions"], "all_group": "Forced only; unforced controls never enter forced bands/rates.",
                 "rollups": "Recomputed on pooled individual samples; do not average medians/IQRs.",
                 "curve_cohort": "Nonfailed trials; per-time finite sample count n. Return bands require complete nonfailed sequences.",
                 "display_sampling": {"source_time_samples": len(data["time"]), "stride": stride,
                                      "retained_indices": indices, "metrics_use_full_time_grid": True}},
                {"pairing": "Exact saved command vectors, phase, condition IDs, labels, groups, requested wrenches, time and metric weights checked across policies.",
                 "per_policy": {p["id"]: {"forced": p["summary"]["forced_trials"],
                                          "controls": len(p["trials"]) - p["summary"]["forced_trials"]}
                                for p in policies},
                 "push_design": "Per command/phase: signed six-axis pulses 80/140 N and 25/40 N m, 12 repeats with +/-8% jitter; "
                                "48 random-6D trials with force/torque norms 15%-100% of 160 N/45 N m; 12 controls. Pulse 0.10 s."},
                ["Strict recovery is teacher 83.72% vs tube 74.74%, not universal tube superiority.",
                 "Straight vx=0.8: tube strict recovery about 3.8% vs teacher 79.0%; median tail error 0.326 vs 0.0841.",
                 "Matched-time error includes phase offset; it does not isolate posture change from timing change.",
                 "Both policies reenter radius-1 tube after exiting, but broad tube membership is not precise motion recovery.",
                 "Same-foot e6/e1 is a six-return recovery ratio, not a single-step eigenvalue; feet are not independent training seeds.",
                 "Some teacher controls have numerical/contact-sampling variability; baseline variation is not all external-force error.",
                 "Curves are decimated for display only; transient peaks between display samples may be missed."])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--only", nargs="+", choices=("saturation", "tracking", "orbits", "recovery"))
    parser.add_argument("--time-stride", type=int, default=4)
    args = parser.parse_args()
    if args.time_stride < 1:
        parser.error("--time-stride must be positive")
    output = args.output_dir.resolve()
    if output == ROOT or (ROOT / "hzd").resolve() in (output, *output.parents):
        parser.error("Output must not be the workspace root or the authoritative hzd source tree")
    builders = {"saturation": lambda: build_saturation(evidence.DISTANCE),
                "tracking": lambda: build_tracking(evidence.ROLLOUTS),
                "orbits": lambda: build_orbits(RUNS / "orbit_families_v2"),
                "recovery": lambda: build_recovery(RUNS / "closed_loop_v2", args.time_stride)}
    for name in args.only or builders:
        print(f"Reading saved {name} evidence...", flush=True)
        payload = builders[name]()
        destination = output / f"{name}.json"
        write_json(destination, payload)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        print(f"{destination.name}: {destination.stat().st_size:,} bytes, sha256 {digest}", flush=True)


if __name__ == "__main__":
    main()
