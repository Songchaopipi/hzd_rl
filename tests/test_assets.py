import importlib.util
from pathlib import Path
import unittest

WEB = Path(__file__).resolve().parents[1]
REPO = WEB.parent


class AssetTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
