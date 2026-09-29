import argparse
import os
import pathlib
import sys

ART_ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO_ROOT = ART_ROOT.parent
CACHE = pathlib.Path(os.environ.get("ART_CACHE", ART_ROOT / ".cache"))
OUT = pathlib.Path(os.environ.get("ART_OUT", ART_ROOT / "out"))
PUBLIC_WORLDS = REPO_ROOT / "public" / "worlds"


def parse(extra=None):
    """Parse the args that follow `--` on the Blender command line.

    Common flags:
      --steps a,b,c   run only these build steps (default: all)
      --variant day|night|both
      --samples N     Cycles sample override for stills/bakes
      --preview       fast low-sample pass for iterating on look
    """
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--steps", default="all")
    p.add_argument("--variant", default="both", choices=["day", "night", "both"])
    p.add_argument("--samples", type=int, default=0)
    p.add_argument("--preview", action="store_true")
    p.add_argument("--save-blend", action="store_true")
    for fn in extra or []:
        fn(p)
    args = p.parse_args(argv)
    args.variants = ["day", "night"] if args.variant == "both" else [args.variant]
    return args


def want(args, step):
    return args.steps == "all" or step in args.steps.split(",")


def scene_dirs(scene_id):
    out = OUT / scene_id
    pub = PUBLIC_WORLDS / scene_id
    for d in (out, pub / "hi", pub / "lo", pub / "posters", pub / "layers"):
        d.mkdir(parents=True, exist_ok=True)
    return out, pub


def log(*a):
    print("[ddd]", *a, flush=True)
