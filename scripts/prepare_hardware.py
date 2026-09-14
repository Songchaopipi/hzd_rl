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
GROUPS = ("forward", "lateral", "turning", "cadence")
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


def describe_filename(name):
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
        magnitude = float("0." + token[1:]) if token.startswith("0") and len(token) > 1 else float(token)
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
        return dict(id=Path(name).stem.lower(), group=group, label=label,
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
    described = [(path, describe_filename(path.name)) for path in paths]
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path.home() / "\u89c6\u9891/hzd")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    manifest = prepare_directory(args.source, args.output)
    print(f"Prepared {len(manifest['videos'])} videos, {manifest['total_duration']:.2f} s, "
          f"{manifest['total_video_bytes'] / 1024 ** 2:.2f} MiB in {args.output}")


if __name__ == "__main__":
    main()
