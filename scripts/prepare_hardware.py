"""Losslessly package HZD hardware videos, posters, and visual review sheets.

Requires ffmpeg, ffprobe, and Pillow. Run from any directory:
    python3 -B FADA-humanoid-main/scripts/prepare_hardware.py --source /path/to/hzd

Only H.264/yuv420p + optional AAC inputs are accepted. Incompatible future
inputs fail explicitly instead of silently changing their image or audio.
Filename command values are labels, not measured tracking or time series.
"""

import argparse
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont, ImageOps


WEB = Path(__file__).resolve().parents[1]
OUTPUT = WEB / "public/hzd/hardware"
PUBLIC_PREFIX = "hzd/hardware/"
GROUPS = ("forward", "lateral", "turning", "cadence", "height")
SAMPLE_FRACTIONS = (0.1, 0.3, 0.5, 0.7, 0.9)
# Selected from the temporal sheets to keep the robot visible in each poster.
POSTER_FRACTIONS = {
    "vy_06_hzd_pos_neg": 0.1,
    "vy_08_hzd_pos_neg": 0.1,
    "wz_hzd_04": 0.9,
    "wz_hzd_06": 0.9,
    "wz_hzd_08": 0.3,
    "t_05_hzd": 0.7,
    "t_08_hzd": 0.9,
}


def _compact_number(token):
    return float("0." + token[1:]) if token.startswith("0") and len(token) > 1 else float(token)


def _teacher_id(key, value):
    sign = "neg" if value < 0 else "pos"
    magnitude = f"{abs(value):g}".replace(".", "p")
    return f"teacher_{key}_{sign}_{magnitude}"


def describe_filename(name, policy="tube"):
    if policy == "teacher":
        match = re.fullmatch(r"(vx|vy|wz)=([+-]?\d+(?:\.\d+)?)\.mp4", name, re.IGNORECASE)
        if match:
            key, value = match.group(1).lower(), float(match.group(2))
            group = {"vx": "forward", "vy": "lateral", "wz": "turning"}[key]
            unit = "rad/s" if key == "wz" else "m/s"
            motion = (("Forward" if value > 0 else "Backward") if key == "vx"
                      else {"vy": "Lateral", "wz": "Turning"}[key])
            return dict(id=_teacher_id(key, value), policy="teacher", group=group,
                        label=f"Teacher | {motion}: {key} = {value:+g} {unit}",
                        command={key: value}, source_name=name)
        match = re.fullmatch(r"t=([0-9]+(?:\.[0-9]+)?)\.mp4", name, re.IGNORECASE)
        if match:
            value = float(match.group(1))
            return dict(id=f"teacher_t_{str(value).replace('.', 'p')}", policy="teacher",
                        group="cadence", label=f"Teacher | Period: T = {value:g} s",
                        command={"period": value}, source_name=name)
        match = re.fullmatch(r"h_(\d+)_t_(\d+)\.mp4", name, re.IGNORECASE)
        if match:
            height, period = (_compact_number(token) for token in match.groups())
            return dict(id=f"teacher_h_{str(height).replace('.', 'p')}_t_{str(period).replace('.', 'p')}",
                        policy="teacher", group="height",
                        label=f"Teacher | Torso height: H = {height:g} m, T = {period:g} s",
                        command={"torso_height": height, "period": period}, source_name=name)
        raise ValueError(f"Unrecognized Teacher filename; refusing to guess commands: {name}")
    if policy != "tube":
        raise ValueError(f"Unknown hardware policy: {policy}")
    patterns = (
        ("forward", "vx", r"vx_(\d+)_(?:hzd(?P<tail>_neg)?|(?P<head>neg)_hzd)\.mp4"),
        ("lateral", "vy", r"vy_(\d+)_hzd_pos_neg\.mp4"),
        ("turning", "wz", r"wz_hzd_(\d+)\.mp4"),
        ("cadence", "period", r"t_(\d+)_hzd\.mp4"),
    )
    for group, key, pattern in patterns:
        match = re.fullmatch(pattern, name, re.IGNORECASE)
        if not match:
            continue
        token = match.group(1)
        magnitude = _compact_number(token)
        if magnitude <= 0:
            raise ValueError(f"Command magnitude must be positive: {name}")
        value = magnitude
        if group == "forward" and any(match.groupdict().values()):
            value = -magnitude
        if group == "lateral":
            command = {key: [-magnitude, magnitude]}
            label = f"Lateral command: vy = +/-{magnitude:g} m/s (both directions)"
        elif group == "cadence":
            command = {key: value}
            label = f"Period command: T = {value:g} s"
        else:
            command = {key: value}
            unit = "rad/s" if group == "turning" else "m/s"
            direction = "Turning" if group == "turning" else ("Forward" if value > 0 else "Backward")
            label = f"{direction} command: {key} = {value:+g} {unit}"
        return dict(id=Path(name).stem.lower(), policy="tube", group=group, label=label,
                    command=command, source_name=name)
    raise ValueError(f"Unrecognized hardware filename; refusing to guess commands: {name}")


def run(arguments):
    result = subprocess.run([str(arg) for arg in arguments], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
    return result.stdout


def probe(path):
    data = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path]))
    data["format"]["filename"] = Path(path).name
    return data


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stream_hashes(path):
    return run(["ffmpeg", "-v", "error", "-nostdin", "-i", path,
                "-map", "0", "-c", "copy", "-f", "streamhash", "-hash", "sha256", "-"]).decode().strip()


def is_faststart(path):
    atoms = []
    with path.open("rb") as handle:
        length = path.stat().st_size
        while handle.tell() < length:
            offset = handle.tell()
            header = handle.read(8)
            if len(header) != 8:
                return False
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extended = handle.read(8)
                if len(extended) != 8:
                    return False
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            if size == 0:
                size = length - offset
            if size < header_size or offset + size > length:
                return False
            atoms.append(kind)
            handle.seek(offset + size)
    return b"moov" in atoms and b"mdat" in atoms and atoms.index(b"moov") < atoms.index(b"mdat")


def compatible_video(data):
    videos = [s for s in data["streams"] if s["codec_type"] == "video"]
    audios = [s for s in data["streams"] if s["codec_type"] == "audio"]
    if (len(videos) != 1 or len(audios) > 1 or len(videos) + len(audios) != len(data["streams"])
            or videos[0]["codec_name"] != "h264" or videos[0]["pix_fmt"] != "yuv420p"
            or videos[0].get("profile") not in ("Constrained Baseline", "Baseline", "Main", "High")
            or any(a["codec_name"] != "aac" for a in audios)):
        raise ValueError(f"Expected H.264/yuv420p and optional AAC: {data['format']['filename']}")
    return videos[0]


def frame_at(path, seconds):
    data = run(["ffmpeg", "-v", "error", "-nostdin", "-threads", "2", "-ss", f"{seconds:.6f}",
                "-i", path, "-map", "0:v:0", "-frames:v", "1", "-threads", "1",
                "-f", "image2pipe", "-c:v", "png", "-"])
    with Image.open(BytesIO(data)) as frame:
        return frame.convert("RGB")


def sheet_font(size):
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default(size=size)


def contact_sheets(entries, directory):
    # Thumbnails are fitted with padding; neither the review sheets nor posters crop.
    overview = Image.new("RGB", (1440, ((len(entries) + 2) // 3) * 340), "#181a1b")
    draw = ImageDraw.Draw(overview)
    for index, entry in enumerate(entries):
        x, y = (index % 3) * 480, (index // 3) * 340
        with Image.open(directory / Path(entry["poster"]).name) as poster:
            fitted = ImageOps.contain(poster, (464, 268))
            overview.paste(fitted, (x + (480 - fitted.width) // 2, y + (268 - fitted.height) // 2))
        draw.text((x + 8, y + 274), entry["source_name"], font=sheet_font(17), fill="white")
        draw.text((x + 8, y + 299),
                  f"{entry['group']} | {entry['duration']:.2f}s | {entry['width']}x{entry['height']}",
                  font=sheet_font(15), fill="#c6d1c9")
    overview.save(directory / "contact-sheet.jpg", quality=90)
    review_paths = {}
    for group in GROUPS:
        selected = [entry for entry in entries if entry["group"] == group]
        if not selected:
            continue
        sheet = Image.new("RGB", (1600, len(selected) * 254), "#181a1b")
        draw = ImageDraw.Draw(sheet)
        for row, entry in enumerate(selected):
            y = row * 254
            draw.text((8, y + 6), f"{entry['source_name']} | {entry['label']}",
                      font=sheet_font(17), fill="white")
            for column, fraction in enumerate(SAMPLE_FRACTIONS):
                time = entry["duration"] * fraction
                frame = frame_at(directory / Path(entry["src"]).name, time)
                fitted = ImageOps.contain(frame, (312, 180))
                x = column * 320
                sheet.paste(fitted, (x + (320 - fitted.width) // 2, y + 34 + (180 - fitted.height) // 2))
                draw.text((x + 8, y + 222), f"t = {time:.2f} s", font=sheet_font(16), fill="#c6d1c9")
        name = f"review-{group}.jpg"
        sheet.save(directory / name, quality=90)
        review_paths[group] = PUBLIC_PREFIX + name
    return PUBLIC_PREFIX + "contact-sheet.jpg", review_paths


def prepare_directory(source, output=OUTPUT):
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or source in output.parents or output in source.parents:
        raise ValueError("Source and output directories must be separate and non-nested")
    paths = sorted((p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".mp4"),
                   key=lambda p: p.name.lower())
    if not paths:
        raise ValueError(f"No MP4 sources found in {source}")
    described = [(path, describe_filename(path.name, policy="tube")) for path in paths]
    described.sort(key=lambda pair: (GROUPS.index(pair[1]["group"]), pair[1]["id"]))
    if len({entry["id"] for _, entry in described}) != len(described):
        raise ValueError("Source filenames produce duplicate IDs")
    output.mkdir(parents=True, exist_ok=True)
    entries, inspections = [], []
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=output) as temporary:
        staging = Path(temporary)
        for path, entry in described:
            print(f"Preparing {path.name}", flush=True)
            before_hash, before_mtime = sha256(path), path.stat().st_mtime_ns
            original = probe(path)
            original_video = compatible_video(original)
            destination = staging / (entry["id"] + ".mp4")
            run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0",
                 "-c", "copy", "-movflags", "+faststart", destination])
            processed = probe(destination)
            video = compatible_video(processed)
            if any(original_video.get(field) != video.get(field)
                   for field in ("width", "height", "pix_fmt", "nb_frames", "sample_aspect_ratio")):
                raise RuntimeError(f"Remux changed video geometry or frame count: {path.name}")
            duration = float(processed["format"]["duration"])
            if abs(duration - float(original["format"]["duration"])) > 0.05:
                raise RuntimeError(f"Remux changed duration: {path.name}")
            source_streams, output_streams = stream_hashes(path), stream_hashes(destination)
            if source_streams != output_streams or not is_faststart(destination):
                raise RuntimeError(f"Remux payload/faststart verification failed: {path.name}")
            run(["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-err_detect", "explode",
                 "-threads", "2", "-i", destination, "-map", "0", "-f", "null", "-"])
            poster_name = entry["id"] + ".jpg"
            poster_time = round(duration * POSTER_FRACTIONS.get(entry["id"], 0.5), 6)
            frame_at(destination, poster_time).save(staging / poster_name, quality=90)
            entry.update(src=PUBLIC_PREFIX + destination.name, poster=PUBLIC_PREFIX + poster_name,
                         duration=duration, width=video["width"], height=video["height"],
                         size_bytes=destination.stat().st_size, poster_time=poster_time)
            entries.append(entry)
            if before_hash != sha256(path) or before_mtime != path.stat().st_mtime_ns:
                raise RuntimeError(f"Source changed during preparation: {path.name}")
            inspections.append(dict(source_name=path.name, source_sha256=before_hash,
                                    source_mtime_ns=before_mtime, output_sha256=sha256(destination),
                                    source_unchanged=True, stream_payloads_identical=True, faststart=True,
                                    full_decode_ok=True, stream_hashes=output_streams,
                                    source_probe=original, output_probe=processed))
        contact_sheet, review_sheets = contact_sheets(entries, staging)
        manifest = dict(
            schema_version=1, videos=entries,
            command_units=dict(vx="m/s", vy="m/s", wz="rad/s", period="s"),
            command_semantics={
                "source": "Filename labels denote commanded values, not measured motion.",
                "arrays": "A numeric array lists commands represented in the clip, not their order or timing.",
                "lateral": "pos_neg means both directions; per-frame commands are unavailable.",
                "unspecified": "Omitted command components are unknown, not assumed zero.",
                "period": "T denotes the commanded gait period in seconds, not measured cadence.",
            },
            contact_sheet=contact_sheet, review_sheets=review_sheets,
            inspection=PUBLIC_PREFIX + "inspection.json",
            total_duration=round(sum(entry["duration"] for entry in entries), 6),
            total_video_bytes=sum(entry["size_bytes"] for entry in entries),
        )
        for name, data in (("manifest.json", manifest), ("inspection.json", dict(
                processing="Lossless stream copy with +faststart; no crop, trim, resize, or audio removal.",
                sample_fractions=list(SAMPLE_FRACTIONS), videos=inspections))):
            (staging / name).write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        # Publish the manifest last, only after every source and generated asset passes.
        for artifact in sorted(staging.iterdir(), key=lambda p: p.name == "manifest.json"):
            artifact.replace(output / artifact.name)
    return manifest


def prepare_teacher_directory(source, output=OUTPUT):
    """Replace only Teacher recordings while preserving all published Tube assets."""
    source, output = Path(source).resolve(), Path(output).resolve()
    manifest_path, inspection_path = output / "manifest.json", output / "inspection.json"
    if not manifest_path.is_file() or not inspection_path.is_file():
        raise ValueError("Publish the Tube hardware bundle before merging Teacher recordings")
    paths = sorted(source.glob("*.mp4"), key=lambda path: path.name.lower())
    described = [(path, describe_filename(path.name, policy="teacher")) for path in paths]
    described.sort(key=lambda pair: (GROUPS.index(pair[1]["group"]), pair[1]["id"]))
    if not described:
        raise ValueError(f"No Teacher MP4 sources found in {source}")
    if len({entry["id"] for _, entry in described}) != len(described):
        raise ValueError("Teacher filenames produce duplicate IDs")

    previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old_teacher = [entry for entry in previous_manifest["videos"]
                   if entry.get("policy") == "teacher" or entry.get("group") == "teacher"]
    retained = [entry for entry in previous_manifest["videos"] if entry not in old_teacher]
    for entry in retained:
        entry["policy"] = "tube"
    previous_inspection = json.loads(inspection_path.read_text(encoding="utf-8"))
    old_names = {entry["source_name"] for entry in old_teacher}
    retained_inspections = [entry for entry in previous_inspection.get("videos", [])
                            if entry.get("source_name") not in old_names]

    entries, inspections = [], []
    with tempfile.TemporaryDirectory(prefix=".prepare-teacher-", dir=output) as temporary:
        staging = Path(temporary)
        for path, entry in described:
            print(f"Preparing Teacher {path.name}", flush=True)
            before_hash, before_mtime = sha256(path), path.stat().st_mtime_ns
            original = probe(path)
            original_video = compatible_video(original)
            destination = staging / (entry["id"] + ".mp4")
            run(["ffmpeg", "-v", "error", "-nostdin", "-i", path, "-map", "0",
                 "-c", "copy", "-movflags", "+faststart", destination])
            processed = probe(destination)
            video = compatible_video(processed)
            if any(original_video.get(field) != video.get(field)
                   for field in ("width", "height", "pix_fmt", "nb_frames", "sample_aspect_ratio")):
                raise RuntimeError(f"Remux changed video geometry or frame count: {path.name}")
            duration = float(processed["format"]["duration"])
            if abs(duration - float(original["format"]["duration"])) > 0.05:
                raise RuntimeError(f"Remux changed duration: {path.name}")
            source_streams, output_streams = stream_hashes(path), stream_hashes(destination)
            if source_streams != output_streams or not is_faststart(destination):
                raise RuntimeError(f"Remux payload/faststart verification failed: {path.name}")
            run(["ffmpeg", "-v", "error", "-xerror", "-nostdin", "-err_detect", "explode",
                 "-threads", "2", "-i", destination, "-map", "0", "-f", "null", "-"])
            poster_name = entry["id"] + ".jpg"
            poster_time = round(duration * 0.5, 6)
            frame_at(destination, poster_time).save(staging / poster_name, quality=90)
            entry.update(src=PUBLIC_PREFIX + destination.name, poster=PUBLIC_PREFIX + poster_name,
                         duration=duration, width=video["width"], height=video["height"],
                         size_bytes=destination.stat().st_size, poster_time=poster_time)
            entries.append(entry)
            if before_hash != sha256(path) or before_mtime != path.stat().st_mtime_ns:
                raise RuntimeError(f"Source changed during preparation: {path.name}")
            inspections.append(dict(policy="teacher", source_name=path.name,
                                    source_sha256=before_hash, source_mtime_ns=before_mtime,
                                    output_sha256=sha256(destination), source_unchanged=True,
                                    stream_payloads_identical=True, faststart=True, full_decode_ok=True,
                                    stream_hashes=output_streams, source_probe=original,
                                    output_probe=processed))

        videos = retained + entries
        manifest = {**previous_manifest, "schema_version": 2, "videos": videos,
                    "total_duration": round(sum(entry["duration"] for entry in videos), 6),
                    "total_video_bytes": sum(entry["size_bytes"] for entry in videos)}
        manifest.setdefault("command_units", {})["torso_height"] = "m"
        inspection = {**previous_inspection, "videos": retained_inspections + inspections}
        (staging / "inspection.json").write_text(
            json.dumps(inspection, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        (staging / "manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")

        for entry in old_teacher:
            for key in ("src", "poster"):
                artifact = output / Path(entry[key]).name
                if artifact.exists():
                    artifact.unlink()
        for artifact in sorted(staging.iterdir(), key=lambda path: path.name == "manifest.json"):
            artifact.replace(output / artifact.name)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.home() / "\u89c6\u9891/hzd")
    parser.add_argument("--teacher-source", type=Path,
                        help="Merge Teacher recordings without replacing published Tube videos")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    manifest = (prepare_teacher_directory(args.teacher_source, args.output)
                if args.teacher_source else prepare_directory(args.source, args.output))
    print(f"Prepared {len(manifest['videos'])} videos, {manifest['total_duration']:.2f} s, "
          f"{manifest['total_video_bytes'] / 1024 ** 2:.2f} MiB in {args.output}")


if __name__ == "__main__":
    main()
