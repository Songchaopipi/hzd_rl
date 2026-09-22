#!/usr/bin/env python3
"""Build browser bundles for H1-2 and Booster T1 locomotion demos.

Run from the repository root with the ``g1_cp`` environment:

    /home/songchao/anaconda3/envs/g1_cp/bin/python \
      FADA-humanoid-main/scripts/prepare_web_bundles.py

This script is intentionally narrow:

* it copies existing H1-2 ONNX exports;
* it exports Booster T1 teacher/tube checkpoints to ONNX;
* it packages the MJCF scene plus only the STL meshes referenced by that scene;
* it writes the same manifest contract consumed by ``LocomotionController``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import xml.etree.ElementTree as ET

WEB = Path(__file__).resolve().parents[1]
REPO = Path(__file__).resolve().parents[2]

for path in (REPO, REPO / "rsl_rl", REPO / "instinct_rl"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_floats(text: str | None) -> list[float]:
    if not text:
        return []
    return [float(item) for item in text.split(",") if item.strip()]


def csv_int(text: str | None) -> list[int]:
    if not text:
        return []
    return [int(item) for item in text.split(",") if item.strip()]


def parse_floats(text: str | None, default: list[float] | None = None) -> list[float]:
    if text is None:
        return [0.0, 0.0, 0.0] if default is None else default
    return [float(item) for item in text.split()]


def parse_rgba(text: str | None) -> list[float]:
    return parse_floats(text, [0.7, 0.7, 0.7, 1.0])


def parse_quat(text: str | None) -> list[float]:
    return parse_floats(text, [1.0, 0.0, 0.0, 0.0])


def load_onnx_metadata(path: Path) -> dict[str, str]:
    import onnxruntime as ort

    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return dict(session.get_modelmeta().custom_metadata_map)


def compile_model(path: Path):
    import mujoco

    return mujoco.MjModel.from_xml_path(str(path))


def model_visuals(model, xml_path: Path) -> list[dict]:
    import mujoco

    tree = ET.parse(xml_path)
    asset = tree.getroot().find("asset")
    mesh_files = {
        element.attrib["name"]: element.attrib["file"]
        for element in asset.findall("mesh")
    } if asset is not None else {}
    visuals: list[dict] = []
    for body in tree.iter("body"):
        body_name = body.attrib.get("name")
        if not body_name:
            continue
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body_name)
        for geom in body.findall("geom"):
            # H1's visual meshes are group=1; collision/ghost meshes are group=0/3.
            if geom.get("type") != "mesh" or geom.get("group") != "1":
                continue
            mesh = geom.get("mesh")
            if not mesh:
                continue
            file_name = mesh_files.get(mesh, mesh)
            visuals.append({
                "body": int(body_id),
                "mesh": file_name,
                "pos": parse_floats(geom.get("pos"), [0.0, 0.0, 0.0]),
                "quat": parse_quat(geom.get("quat")),
                "rgba": parse_rgba(geom.get("rgba")),
            })
    return visuals


def xml_meshes(xml_path: Path) -> list[str]:
    root = ET.parse(xml_path).getroot()
    asset = root.find("asset")
    if asset is None:
        return []
    return [element.attrib["file"] for element in asset.findall("mesh")]


def write_scene(xml_path: Path, output_dir: Path, meshes: list[str], timestep: float) -> Path:
    tree = ET.parse(xml_path)
    root = tree.getroot()
    compiler = root.find("compiler")
    if compiler is not None:
        compiler.set("meshdir", "meshes")
    option = root.find("option")
    if option is None:
        option = ET.Element("option")
        root.insert(1 if compiler is not None else 0, option)
    option.set("timestep", str(timestep))
    destination = output_dir / "scene.xml"
    tree.write(destination, encoding="utf-8", xml_declaration=True)
    return destination


def h1_policy_config(onnx_path: Path, model) -> dict:
    import mujoco

    meta = load_onnx_metadata(onnx_path)
    default = csv_floats(meta["default_joint_pos"])
    stiffness = csv_floats(meta["joint_stiffness"])
    damping = csv_floats(meta["joint_damping"])
    action_scale = csv_floats(meta["action_scale"])
    joint_names = meta["joint_names"].split(",")
    assert len(joint_names) == len(default) == len(stiffness) == len(damping) == len(action_scale) == 27

    joints = []
    effort_limit: list[float] = []
    for name in joint_names:
        joint_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        actuator_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
        joints.append({
            "name": name,
            "qpos": int(model.jnt_qposadr[joint_id]),
            "dof": int(model.jnt_dofadr[joint_id]),
        })
        effort_limit.append(float(max(abs(model.actuator_ctrlrange[actuator_id]))))

    return {
        "default_joint_pos": default,
        "stiffness": stiffness,
        "damping": damping,
        "effort_limit": effort_limit,
        "action_scale": action_scale,
        "action_offset": list(default),
        "step_dt": 0.02,
        "initial_qpos": [0.0, 0.0, 1.02, 1.0, 0.0, 0.0, 0.0] + list(default),
        "joints": joints,
    }


def t1_policy_config() -> dict:
    default = [-0.2, 0.0, 0.0, 0.4, -0.25, 0.0] * 2
    stiffness = [200.0, 200.0, 200.0, 200.0, 50.0, 50.0] * 2
    damping = [5.0, 5.0, 5.0, 5.0, 1.0, 1.0] * 2
    effort_limit = [45.0, 30.0, 30.0, 60.0, 24.0, 15.0] * 2
    action_scale = [1.0] * 12
    names = [
        "Left_Hip_Pitch", "Left_Hip_Roll", "Left_Hip_Yaw",
        "Left_Knee_Pitch", "Left_Ankle_Pitch", "Left_Ankle_Roll",
        "Right_Hip_Pitch", "Right_Hip_Roll", "Right_Hip_Yaw",
        "Right_Knee_Pitch", "Right_Ankle_Pitch", "Right_Ankle_Roll",
    ]
    # The free joint occupies qpos[0:7]/qvel[0:6]; actuator order matches names.
    joints = [
        {"name": name, "qpos": 7 + i, "dof": 6 + i}
        for i, name in enumerate(names)
    ]
    return {
        "default_joint_pos": default,
        "stiffness": stiffness,
        "damping": damping,
        "effort_limit": effort_limit,
        "action_scale": action_scale,
        "action_offset": list(default),
        "step_dt": 0.02,
        "initial_qpos": [0.0, 0.0, 0.72, 1.0, 0.0, 0.0, 0.0] + list(default),
        "joints": joints,
    }


def export_booster_policy(task: str, checkpoint: Path, output_dir: Path) -> None:
    """Export a feed-forward Booster T1 checkpoint to ONNX."""
    import hzd.runtime_compat as runtime_compat

    runtime_compat.prepare_runtime()

    import torch
    from mjlab.envs import ManagerBasedRlEnv
    from mjlab.rl import RslRlVecEnvWrapper
    from mjlab.tasks.registry import load_env_cfg, load_rl_cfg, load_runner_cls
    from mjlab.utils.torch import configure_torch_backends

    sys.path.insert(0, str(REPO / "scripts"))
    from play import _agent_cfg_to_dict, _load_policy_checkpoint

    configure_torch_backends()
    env_cfg = load_env_cfg(task, play=True)
    env_cfg.scene.num_envs = 1
    agent_cfg = load_rl_cfg(task)

    env = ManagerBasedRlEnv(cfg=env_cfg, device="cpu")
    env = RslRlVecEnvWrapper(env, clip_actions=_agent_cfg_to_dict(agent_cfg).get("clip_actions"))
    runner_cls = load_runner_cls(task)
    runner = runner_cls(env, _agent_cfg_to_dict(agent_cfg), device="cpu")
    _load_policy_checkpoint(runner, checkpoint, "cpu", task)

    output_dir.mkdir(parents=True, exist_ok=True)
    runner.export_policy_to_onnx(str(output_dir))
    env.close()
    del runner, env
    torch.cuda.empty_cache()


def make_h1_manifest(teacher: Path, tube: Path) -> dict:
    import mujoco

    xml_path = REPO / "src/assets/robots/unitree_h1_2/xmls/scene_h1_2.xml"
    model = compile_model(xml_path)
    assert (model.nq, model.nv, model.nu) == (34, 33, 27)
    torso_body = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "torso_link"))
    teacher_cfg = h1_policy_config(teacher, model)
    tube_cfg = h1_policy_config(tube, model)
    assert teacher_cfg["joints"] == tube_cfg["joints"]
    assert teacher_cfg["default_joint_pos"] == tube_cfg["default_joint_pos"]

    return {
        "id": "h1",
        "label": "Unitree H1-2",
        "contract": "h1_2_gait_5cmd_v1",
        "physics_dt": 0.005,
        "step_dt": 0.02,
        "decimation": 4,
        "obs_dim": 94,
        "action_dim": 27,
        "command_kind": "5cmd",
        "action_kind": "position",
        "command_ranges": [[-1.0, 2.0], [-1.0, 1.0], [-1.0, 1.0], [0.5, 1.0], [0.85, 1.05]],
        "command_defaults": [0.4, 0.0, 0.0, 0.8, 1.0],
        "model": "scene.xml",
        "meshes": xml_meshes(xml_path),
        "visuals": model_visuals(model, xml_path),
        "torso_body": torso_body,
        "force_body": torso_body,
        "fallen_height": 0.70,
        "policies": [
            {"id": "teacher", "label": "H1-2 Teacher", "onnx": "teacher.onnx", "config": teacher_cfg},
            {"id": "tube", "label": "H1-2 HZD-Tube", "onnx": "tube.onnx", "config": tube_cfg},
        ],
    }


def make_t1_manifest() -> dict:
    import mujoco

    xml_path = REPO / "src/assets/robots/booster_gym/resources/T1/T1_locomotion.xml"
    model = compile_model(xml_path)
    assert (model.nq, model.nv, model.nu) == (19, 18, 12)
    torso_body = int(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "Trunk"))
    cfg = t1_policy_config()

    return {
        "id": "t1",
        "label": "Booster T1",
        "contract": "booster_t1_gym_3cmd_v1",
        "physics_dt": 0.002,
        "step_dt": 0.02,
        "decimation": 10,
        "obs_dim": 47,
        "action_dim": 12,
        "command_kind": "3cmd",
        "action_kind": "effort_pd",
        "command_ranges": [[-1.0, 1.0], [-1.0, 1.0], [-1.0, 1.0]],
        "command_defaults": [0.5, 0.0, 0.0],
        "model": "scene.xml",
        "meshes": xml_meshes(xml_path),
        "visuals": model_visuals(model, xml_path),
        "torso_body": torso_body,
        "force_body": torso_body,
        "fallen_height": 0.45,
        "policies": [
            {"id": "teacher", "label": "T1 Teacher", "onnx": "teacher.onnx", "config": cfg},
            {"id": "tube", "label": "T1 HZD-Tube", "onnx": "tube.onnx", "config": cfg},
        ],
    }


def write_bundle(manifest: dict, output_root: Path) -> None:
    output = output_root / manifest["id"]
    meshes_dir = output / "meshes"
    meshes_dir.mkdir(parents=True, exist_ok=True)

    if manifest["id"] == "h1":
        source_xml = REPO / "src/assets/robots/unitree_h1_2/xmls/scene_h1_2.xml"
        mesh_source = source_xml.parent / "assets"
    elif manifest["id"] == "t1":
        source_xml = REPO / "src/assets/robots/booster_gym/resources/T1/T1_locomotion.xml"
        mesh_source = source_xml.parent / "meshes"
    else:
        raise ValueError(manifest["id"])

    scene_path = write_scene(source_xml, output, manifest["meshes"], float(manifest["physics_dt"]))
    for mesh in manifest["meshes"]:
        shutil.copy2(mesh_source / mesh, meshes_dir / mesh)

    for policy in manifest["policies"]:
        policy["sha256"] = digest(output / policy["onnx"])
    manifest["model_sha256"] = digest(scene_path)
    manifest["model_source_sha256"] = digest(source_xml)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--h1-teacher", type=Path,
                        default=REPO / "logs/rsl_rl/h1_2_gait_command_teacher/2026-09-17_22-11-21/policy.onnx")
    parser.add_argument("--h1-tube", type=Path,
                        default=REPO / "logs/rsl_rl/h1_2_gait_command_hzd_tube_24d/2026-09-18_10-05-19/policy.onnx")
    parser.add_argument("--t1-teacher", type=Path,
                        default=REPO / "logs/rsl_rl/booster_t1_gym_teacher/2026-09-17_22-57-57/model_33999.pt")
    parser.add_argument("--t1-tube", type=Path,
                        default=REPO / "logs/rsl_rl/booster_t1_gym_hzd_tube_24d/2026-09-18_17-45-40/model_36000.pt")
    parser.add_argument("--out", type=Path, default=WEB / "public/models")
    args = parser.parse_args()

    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    # H1-2: copy existing exports.
    h1_dir = out / "h1"
    h1_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.h1_teacher, h1_dir / "teacher.onnx")
    shutil.copy2(args.h1_tube, h1_dir / "tube.onnx")
    write_bundle(make_h1_manifest(args.h1_teacher, args.h1_tube), out)

    # T1: export checkpoints first.
    t1_dir = out / "t1"
    t1_dir.mkdir(parents=True, exist_ok=True)
    export_booster_policy("Booster-T1-Gym-Teacher", args.t1_teacher, t1_dir)
    teacher_path = t1_dir / "policy.onnx"
    teacher_path.rename(t1_dir / "teacher.onnx")
    export_booster_policy("Booster-T1-Gym-HZD-Tube", args.t1_tube, t1_dir)
    tube_path = t1_dir / "policy.onnx"
    tube_path.rename(t1_dir / "tube.onnx")
    write_bundle(make_t1_manifest(), out)

    print(f"Wrote H1-2 and T1 web bundles under {out}")


if __name__ == "__main__":
    main()
