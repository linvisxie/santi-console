"""Update existing desktop shortcut icon without changing target/arguments."""
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
import json,runpy
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'tools/make-lnk.py'),run_name='icon_helpers')
guid,bind,vtable,VP,PP,LPWSTR=[ns[n] for n in ['guid','bind','vtable','VP','PP','LPWSTR']]

def desktop():
 b=C.create_unicode_buffer(32768)
 shell=C.WinDLL('shell32');shell.SHGetFolderPathW.argtypes=[W.HWND,C.c_int,W.HANDLE,W.DWORD,W.LPWSTR];shell.SHGetFolderPathW.restype=C.c_long
 if shell.SHGetFolderPathW(None,0x10,None,0,b)!=0:raise RuntimeError('Desktop folder lookup failed')
 return Path(b.value)

def shortcut(file,update=False):
 ole=C.WinDLL('ole32');ole.CoInitializeEx.argtypes=[VP,W.DWORD];ole.CoCreateInstance.argtypes=[VP,VP,W.DWORD,VP,PP];ole.CoCreateInstance.restype=C.c_long;ole.CoInitializeEx(None,2)
 link=PP();persist=PP()
 def check(hr):
  if hr!=0:raise RuntimeError(f'COM HRESULT {hr & 0xffffffff:08x}')
 try:
  check(ole.CoCreateInstance(C.cast(guid(ns['CLSID_ShellLink']),VP),None,1,C.cast(guid(ns['IID_IShellLinkW']),VP),C.cast(C.byref(link),PP)))
  vt=vtable(link);check(bind(vt,0,C.c_long,VP,PP)(link,C.cast(guid(ns['IID_IPersistFile']),VP),C.cast(C.byref(persist),PP)))
  pvt=vtable(persist);check(bind(pvt,5,C.c_long,LPWSTR,W.DWORD)(persist,str(file),0))
  def fields():
   target=C.create_unicode_buffer(32768);args=C.create_unicode_buffer(32768);cwd=C.create_unicode_buffer(32768);icon=C.create_unicode_buffer(32768);index=C.c_int()
   check(bind(vt,3,C.c_long,W.LPWSTR,C.c_int,VP,W.DWORD)(link,target,len(target),None,0))
   check(bind(vt,10,C.c_long,W.LPWSTR,C.c_int)(link,args,len(args)))
   check(bind(vt,8,C.c_long,W.LPWSTR,C.c_int)(link,cwd,len(cwd)))
   check(bind(vt,16,C.c_long,W.LPWSTR,C.c_int,C.POINTER(C.c_int))(link,icon,len(icon),C.byref(index)))
   return dict(target=target.value,arguments=args.value,workingDirectory=cwd.value,icon=icon.value,index=index.value)
  before=fields()
  if update:
   if before['target'].endswith('三体控制台.icon-stage.exe'):check(bind(vt,20,C.c_long,LPWSTR)(link,str(ROOT/'runtime/三体控制台.exe')))
   check(bind(vt,17,C.c_long,LPWSTR,C.c_int)(link,str(ROOT/'assets/santi-liquid-glass.ico'),0));check(bind(pvt,6,C.c_long,LPWSTR,W.BOOL)(persist,str(file),True))
  after=fields();assert all(before[k]==after[k] for k in ['arguments','workingDirectory'])
  return dict(path=str(file),before=before,after=after)
 finally:
  if persist:bind(vtable(persist),2,C.c_ulong)(persist)
  if link:bind(vtable(link),2,C.c_ulong)(link)
  ole.CoUninitialize()

if __name__=='__main__':
 files=list(desktop().glob('*三体*.lnk'));assert files,'Existing Santi desktop shortcut not found'
 results=[shortcut(file,True) for file in files]
 (ROOT/'tools/icon-shortcut-results-20261101.json').write_text(json.dumps({'passed':True,'shortcuts':results},ensure_ascii=False,indent=2),encoding='utf-8')
 shell=C.WinDLL('shell32');shell.SHChangeNotify.argtypes=[C.c_long,W.UINT,VP,VP]
 for file in [ROOT/'runtime/三体控制台.exe',*files]:shell.SHChangeNotify(0x2000,0x5,C.cast(C.c_wchar_p(str(file)),VP),None)
 shell.SHChangeNotify(0x08000000,0,None,None)
 print(json.dumps({'updated':[str(f) for f in files],'targetsAndArgumentsPreserved':True},ensure_ascii=False))
