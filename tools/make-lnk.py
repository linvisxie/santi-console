"""
生成桌面快捷方式 (.lnk)。

WScript.Shell 的 COM 在受限环境里被安全策略拦了，改用
IShellLinkW + IPersistFile 直接写 .lnk——内部路径是 UTF-16，
中文路径不会有 GBK 那类编码问题。

注意：这台机器的 Python 是精简 ctypes（没有 c_void，只有 c_void_p），
所有指针类型统一用 c_void_p。
"""
import ctypes
import os
import sys
import uuid

TARGET = r"D:\santi-console\runtime\三体控制台.exe"
WORKDIR = r"D:\santi-console\runtime"
desktop_buffer=ctypes.create_unicode_buffer(32768)
ctypes.windll.shell32.SHGetFolderPathW(None,0x10,None,0,desktop_buffer)
LNK_PATH = os.path.join(desktop_buffer.value,"三体控制台.lnk")

CLSID_ShellLink = "{00021401-0000-0000-C000-000000000046}"
IID_IShellLinkW = "{000214F9-0000-0000-C000-000000000046}"
IID_IPersistFile = "{0000010B-0000-0000-C000-000000000046}"

VP = ctypes.c_void_p
LPWSTR = ctypes.c_wchar_p
PP = ctypes.POINTER(ctypes.c_void_p)
GUID = ctypes.c_byte * 16


def guid(s):
    return GUID.from_buffer_copy(uuid.UUID(s).bytes_le)


def vtable(ptr):
    """取虚表首地址。"""
    return ctypes.cast(ptr, PP).contents


def bind(vtbl, idx, restype, *argtypes):
    slot = ctypes.cast(vtbl, PP)[idx]
    addr = slot.value if hasattr(slot, "value") else slot
    return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(addr)


def make_lnk(target, workdir, icon, description, out_path):
    ole32 = ctypes.WinDLL("ole32.dll")
    ole32.CoInitializeEx.restype = ctypes.c_long
    ole32.CoInitializeEx.argtypes = [VP, ctypes.c_uint32]
    ole32.CoCreateInstance.restype = ctypes.c_long
    ole32.CoCreateInstance.argtypes = [VP, VP, ctypes.c_uint32, VP, PP]
    ole32.CoUninitialize.argtypes = []

    ole32.CoInitializeEx(None, 2)  # COINIT_APARTMENTTHREADED
    try:
        link = PP()
        cls = guid(CLSID_ShellLink)
        iid = guid(IID_IShellLinkW)
        hr = ole32.CoCreateInstance(
            ctypes.cast(cls, VP),
            None,
            1,  # CLSCTX_INPROC_SERVER
            ctypes.cast(iid, VP),
            ctypes.cast(ctypes.byref(link), PP),
        )
        if hr != 0:
            raise RuntimeError(f"CoCreateInstance hr=0x{hr & 0xFFFFFFFF:08x}")

        vtbl = vtable(link)

        def check(hr, what):
            if hr != 0:
                raise RuntimeError(f"{what} hr=0x{hr & 0xFFFFFFFF:08x}")

        # IShellLinkW vtable 索引
        check(bind(vtbl, 20, ctypes.c_long, LPWSTR)(link, target), "SetPath")
        check(bind(vtbl, 9, ctypes.c_long, LPWSTR)(link, workdir), "SetWorkingDirectory")
        check(bind(vtbl, 7, ctypes.c_long, LPWSTR)(link, description), "SetDescription")
        check(
            bind(vtbl, 17, ctypes.c_long, LPWSTR, ctypes.c_int)(link, icon, 0),
            "SetIconLocation",
        )
        check(bind(vtbl, 15, ctypes.c_long, ctypes.c_int)(link, 1), "SetShowCmd")

        # QueryInterface(IPersistFile)
        persist = PP()
        iid_pf = guid(IID_IPersistFile)
        hr = bind(vtbl, 0, ctypes.c_long, VP, PP)(
            link, ctypes.cast(iid_pf, VP), ctypes.cast(ctypes.byref(persist), PP)
        )
        if hr != 0 or not persist:
            raise RuntimeError(f"QueryInterface(IPersistFile) hr=0x{hr & 0xFFFFFFFF:08x}")

        pf_vtbl = vtable(persist)
        # IPersistFile vtable: GetClassID=3, IsDirty=4, Load=5, Save=6
        hr = bind(pf_vtbl, 6, ctypes.c_long, LPWSTR, ctypes.c_int)(persist, out_path, True)
        if hr != 0:
            raise RuntimeError(f"Save hr=0x{hr & 0xFFFFFFFF:08x}")

        bind(vtbl, 2, ctypes.c_ulong)(link)
    finally:
        ole32.CoUninitialize()


if __name__ == "__main__":
    try:
        make_lnk(
            TARGET,
            WORKDIR,
            r"D:\santi-console\assets\santi-liquid-glass.ico",
            "Codex / WorkBuddy / dsh 三体控制台",
            LNK_PATH,
        )
        print("created:", LNK_PATH, os.path.getsize(LNK_PATH), "bytes")
    except Exception as e:
        print("lnk 生成失败:", type(e).__name__, e)
        sys.exit(1)
