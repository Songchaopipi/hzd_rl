import importlib.util
from pathlib import Path
import unittest

WEB = Path(__file__).resolve().parents[1]
REPO = WEB.parent


class AssetTests(unittest.TestCase):
    def test_homepage_marks_code_release_as_coming_after_acceptance(self):
        app = (WEB / "src/App.tsx").read_text()
        self.assertIn("Code", app)
        self.assertIn("Coming soon", app)
        self.assertIn("Code will be released upon paper acceptance", app)
        self.assertIn('aria-disabled="true"', app)

    def test_bundle_preserves_native_contract(self):
        spec = importlib.util.spec_from_file_location("prepare_assets", WEB / "scripts/prepare_assets.py")
        self.assertTrue(Path(spec.origin).is_file(), "asset packer must exist")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        manifest = module.build_manifest(REPO)
        self.assertEqual(manifest["contract"], "wbo5_raw_102_v1")
        self.assertEqual(manifest["physics_dt"], .005)
        self.assertEqual(len(manifest["policies"]), 2)
        self.assertGreater(len(manifest["visuals"]), 25)
        for policy in manifest["policies"]:
            cfg = policy["config"]
            self.assertEqual(len(cfg["initial_qpos"]), 36)
            self.assertEqual(len(cfg["joints"]), 29)
            self.assertEqual(cfg["step_dt"], .02)
            self.assertEqual([j["qpos"] for j in cfg["joints"]], list(range(7, 36)))
            self.assertEqual([cfg["action_scale"][i] for i in (19, 20, 21, 26, 27, 28)], [0] * 6)
            self.assertEqual(cfg["initial_qpos"][7:], cfg["default_joint_pos"])
            self.assertEqual(len(policy["sha256"]), 64)

    def test_teacher_hardware_filenames_map_to_policy_and_command_groups(self):
        spec = importlib.util.spec_from_file_location(
            "prepare_hardware", WEB / "scripts/prepare_hardware.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cases = {
            "vx=+0.4.mp4": ("forward", {"vx": 0.4}),
            "vx=-1.mp4": ("forward", {"vx": -1.0}),
            "vy=+0.6.mp4": ("lateral", {"vy": 0.6}),
            "vy=-0.8.mp4": ("lateral", {"vy": -0.8}),
            "wz=0.4.mp4": ("turning", {"wz": 0.4}),
            "T=0.5.mp4": ("cadence", {"period": 0.5}),
            "H_06_T_1.mp4": ("height", {"torso_height": 0.6, "period": 1.0}),
        }
        for filename, (group, command) in cases.items():
            with self.subTest(filename=filename):
                entry = module.describe_filename(filename, policy="teacher")
                self.assertEqual(entry["policy"], "teacher")
                self.assertEqual(entry["group"], group)
                self.assertEqual(entry["command"], command)

    def test_published_hardware_manifest_contains_complete_teacher_set(self):
        manifest_path = WEB / "public/hzd/hardware/manifest.json"
        import json
        manifest = json.loads(manifest_path.read_text())
        teacher = [video for video in manifest["videos"] if video.get("policy") == "teacher"]
        self.assertEqual(len(teacher), 20)
        self.assertEqual(
            {video["group"] for video in teacher},
            {"forward", "lateral", "turning", "cadence", "height"},
        )


if __name__ == "__main__":
    unittest.main()
