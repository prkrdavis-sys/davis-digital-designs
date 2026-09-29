"""OpenImageDenoise through ctypes, using the library bundled with Blender.

Cycles bakes are never denoised by Blender itself; this runs the RT filter on
float numpy images (H, W, 3), optionally guided by albedo and normal passes.
"""

import ctypes
import glob
import os
import pathlib

import numpy as np

_lib = None
FLOAT3 = 3


def _load():
    global _lib
    if _lib is not None:
        return _lib
    import bpy

    root = pathlib.Path(bpy.app.binary_path).parent / "lib"
    cands = sorted(glob.glob(str(root / "libOpenImageDenoise.so*"))) + sorted(glob.glob(str(root / "*OpenImageDenoise*.dylib")))
    if not cands:
        raise RuntimeError(f"OpenImageDenoise not found in {root}")
    os.environ.setdefault("OIDN_VERBOSE", "0")
    lib = ctypes.CDLL(cands[0], mode=ctypes.RTLD_GLOBAL)
    lib.oidnNewDevice.restype = ctypes.c_void_p
    lib.oidnNewDevice.argtypes = [ctypes.c_int]
    lib.oidnCommitDevice.argtypes = [ctypes.c_void_p]
    lib.oidnGetDeviceError.restype = ctypes.c_int
    lib.oidnGetDeviceError.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_char_p)]
    lib.oidnNewFilter.restype = ctypes.c_void_p
    lib.oidnNewFilter.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
    lib.oidnSetSharedFilterImage.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t]
    lib.oidnSetFilterBool.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_bool]
    lib.oidnCommitFilter.argtypes = [ctypes.c_void_p]
    lib.oidnExecuteFilter.argtypes = [ctypes.c_void_p]
    lib.oidnReleaseFilter.argtypes = [ctypes.c_void_p]
    lib.oidnReleaseDevice.argtypes = [ctypes.c_void_p]
    _lib = lib
    return lib


def _check(lib, dev):
    msg = ctypes.c_char_p()
    code = lib.oidnGetDeviceError(dev, ctypes.byref(msg))
    if code:
        raise RuntimeError(f"OIDN error {code}: {msg.value.decode() if msg.value else ''}")


def denoise(color, albedo=None, normal=None, hdr=True):
    """color/albedo/normal: float32 arrays (H, W, 3). Returns the denoised color."""
    lib = _load()
    h, w = color.shape[:2]
    col = np.ascontiguousarray(color[..., :3], dtype=np.float32)
    out = np.empty_like(col)
    dev = lib.oidnNewDevice(1)  # CPU
    lib.oidnCommitDevice(dev)
    _check(lib, dev)
    flt = lib.oidnNewFilter(dev, b"RT")
    keep = [col, out]

    def img(name, arr):
        a = np.ascontiguousarray(arr[..., :3], dtype=np.float32)
        keep.append(a)
        lib.oidnSetSharedFilterImage(flt, name, a.ctypes.data, FLOAT3, w, h, 0, 0, 0)

    lib.oidnSetSharedFilterImage(flt, b"color", col.ctypes.data, FLOAT3, w, h, 0, 0, 0)
    if albedo is not None:
        img(b"albedo", albedo)
        if normal is not None:
            img(b"normal", normal)
    lib.oidnSetSharedFilterImage(flt, b"output", out.ctypes.data, FLOAT3, w, h, 0, 0, 0)
    lib.oidnSetFilterBool(flt, b"hdr", hdr)
    lib.oidnCommitFilter(flt)
    lib.oidnExecuteFilter(flt)
    _check(lib, dev)
    lib.oidnReleaseFilter(flt)
    lib.oidnReleaseDevice(dev)
    del keep
    return out
