"""Package existing WBO5 deployment assets without changing the robot/controller."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET

import mujoco
import numpy as np
import onnxruntime as ort
import yaml

WEB = Path(__file__).resolve().parents[1]
CONTRACT = "wbo5_raw_102_v1"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def floats(text, default):
    return list(map(float, text.split())) if text is not None else default


def build_manifest(repo):
    scene = repo / "simulate/model_based/models/wbo5_g1.xml"
    model = mujoco.MjModel.from_xml_path(str(scene))
    assert (model.nq, model.nv, model.nu) == (36, 35, 29)
    tree = ET.parse(scene)
    assets = tree.getroot().find("asset")
    mesh_files = {e.attrib["name"]: e.attrib["file"] for e in assets.findall("mesh")}
    materials = {e.attrib["name"]: floats(e.get("rgba"), [.7, .7, .7, 1]) for e in assets.findall("material")}
    visuals = []
    for body in tree.iter("body"):
        body_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, body.attrib["name"])
        for geom in body.findall("geom"):
            if geom.get("class") != "visual":
                continue
            visuals.append(dict(body=int(body_id), mesh=mesh_files[geom.attrib["mesh"]],
                                pos=floats(geom.get("pos"), [0, 0, 0]),
                                quat=floats(geom.get("quat"), [1, 0, 0, 0]),
                                rgba=materials[geom.get("material", "silver")]))
    policies = []
    for key, name, label in (("teacher", "wbo5_teacher", "Teacher"), ("tube", "wbo5_hzd_tube", "HZD-Tube")):
        bundle = repo / "deploy/robots/g1/config/policy/velocity" / name
        config = yaml.safe_load((bundle / "params/deploy.yaml").read_text())
        path = bundle / "exported/policy.onnx"
        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        metadata = session.get_modelmeta().custom_metadata_map
        assert metadata["hzd_observation_contract"] == config["observation_contract"] == CONTRACT
        assert session.get_inputs()[0].shape == [1, 102] and session.get_outputs()[0].shape == [1, 29]
        cfg = {k: config[k] for k in ("default_joint_pos", "stiffness", "damping", "effort_limit", "step_dt")}
        cfg["action_scale"] = config["actions"]["JointPositionAction"]["scale"]
        cfg["action_offset"] = config["actions"]["JointPositionAction"]["offset"]
        for field in ("action_scale", "action_offset", "default_joint_pos", "step_dt"):
            np.testing.assert_allclose(cfg[field], json.loads(metadata["hzd_" + field]), rtol=1e-6, atol=1e-7)
        assert config["joint_ids_map"] == list(range(29))
        assert config["initial_base_rpy"] == [0, 0, 0]
        cfg["initial_qpos"] = [0, 0, config["initial_base_height"], 1, 0, 0, 0] + cfg["default_joint_pos"]
        cfg["joints"] = []
        for joint_id in model.actuator_trnid[:, 0]:
            cfg["joints"].append(dict(name=mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_id),
                                      qpos=int(model.jnt_qposadr[joint_id]), dof=int(model.jnt_dofadr[joint_id])))
        policies.append(dict(id=key, label=label, onnx=f"{key}.onnx", sha256=digest(path), config=cfg,
                             source=str(path.relative_to(repo)), config_sha256=digest(bundle / "params/deploy.yaml")))
    assert policies[0]["config"] == policies[1]["config"], "Matched demo requires identical physical configuration"
    ranges = config["commands"]["base_velocity"]["ranges"]
    gait = config["observations"]["wbo5_commands"]["params"]
    return dict(contract=CONTRACT, physics_dt=float(model.opt.timestep), native_version=mujoco.__version__,
                command_ranges=[ranges[k] for k in ("lin_vel_x", "lin_vel_y", "ang_vel_z")]
                + [[gait["min"][i], gait["max"][i]] for i in range(2)],
                model="scene.xml", model_source_sha256=digest(scene), meshes=list(mesh_files.values()), visuals=visuals,
                torso_body=mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "torso_link"), policies=policies)


def reference_samples(manifest, repo):
    """CPU ONNX golden outputs and explicit native serial observation ordering."""
    cfg = manifest["policies"][0]["config"]
    rng = np.random.default_rng(42)
    samples = []
    for step, command in ((0, [0, 0, 0, .8, .75]), (17, [.4, -.2, .5, .8, .7]), (18, [.4, 0, 0, .55, .7])):
        q = np.array(cfg["initial_qpos"], dtype=float)
        q[7:] += rng.normal(0, .03, 29)
        v = rng.normal(0, .15, 35)
        previous = rng.normal(0, .1, 29)
        phase = 2 * np.pi * step * cfg["step_dt"] / command[3]
        pair = [np.sin(phase), np.cos(phase)] if np.hypot(*command[:2]) + abs(command[2]) >= .1 else [0, 0]
        obs = np.array([*v[3:6], 0, 0, -1, *command[:2], 0, 0, command[2], *command[3:], *pair,
                        *(q[7:] - cfg["default_joint_pos"]), *v[6:], *previous], dtype=np.float32)
        actions = {}
        for policy in manifest["policies"]:
            session = ort.InferenceSession(str(repo / policy["source"]), providers=["CPUExecutionProvider"])
            actions[policy["id"]] = session.run(None, {"obs": obs[None]})[0][0].tolist()
        samples.append(dict(step=step, command=command, qpos=q.tolist(), qvel=v.tolist(), previous=previous.tolist(),
                            obs=obs.tolist(), actions=actions))
    return samples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=WEB.parent)
    parser.add_argument("--paper", type=Path, default=Path("/home/songchao/paper_template/RAL_HZD"))
    args = parser.parse_args()
    repo = args.repo.resolve()
    manifest = build_manifest(repo)
    output = WEB / "public/models/locomotion"
    (output / "meshes").mkdir(parents=True, exist_ok=True)
    scene = repo / "simulate/model_based/models/wbo5_g1.xml"
    tree = ET.parse(scene)
    compiler = tree.getroot().find("compiler")
    meshdir = (scene.parent / compiler.attrib["meshdir"]).resolve()
    compiler.set("meshdir", "meshes")
    for filename in manifest["meshes"]:
        shutil.copy2(meshdir / filename, output / "meshes" / filename)
    tree.write(output / "scene.xml", encoding="utf-8", xml_declaration=True)
    manifest["model_sha256"] = digest(output / "scene.xml")
    for policy in manifest["policies"]:
        shutil.copy2(repo / policy["source"], output / policy["onnx"])
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (WEB / "tests/reference.json").write_text(json.dumps(reference_samples(manifest, repo)) + "\n")
    paper_out = WEB / "public/hzd"
    paper_out.mkdir(exist_ok=True)
    tex = (args.paper / "New_IEEEtran_how-to.tex").read_text()
    title = re.search(r"\\title\{([^}]+)\}", tex).group(1)
    abstract = re.search(r"\\begin\{abstract\}(.*?)\\end\{abstract\}", tex, re.S).group(1)
    abstract = re.sub(r"\\textbf\{([^}]+)\}", r"\1", abstract).replace("Poincar\\'e", "Poincare")
    abstract = " ".join(abstract.split())
    (paper_out / "paper.json").write_text(json.dumps(dict(title=title, abstract=abstract), indent=2) + "\n")
    shutil.copy2(args.paper / "fig_hzd_framework.png", paper_out / "framework.png")
    print(f"Packaged {len(manifest['policies'])} policies and {len(manifest['meshes'])} meshes into {output}")


if __name__ == "__main__":
    main()
