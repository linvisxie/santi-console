"""Replace only PE icon resources in a staged executable and verify other sections."""
import ctypes as C
from ctypes import wintypes as W
from pathlib import Path
import hashlib,json,shutil,struct
ROOT=Path(__file__).resolve().parents[1]
exe=ROOT/'runtime/三体控制台.exe'; stage=ROOT/'runtime/三体控制台.icon-stage.exe'; ico=ROOT/'assets/santi-liquid-glass.ico'
k=C.WinDLL('kernel32',use_last_error=True)
k.LoadLibraryExW.argtypes=[W.LPCWSTR,W.HANDLE,W.DWORD];k.LoadLibraryExW.restype=W.HMODULE
k.FreeLibrary.argtypes=[W.HMODULE]
k.FindResourceW.argtypes=[W.HMODULE,C.c_void_p,C.c_void_p];k.FindResourceW.restype=C.c_void_p
k.LoadResource.argtypes=[W.HMODULE,C.c_void_p];k.LoadResource.restype=C.c_void_p
k.LockResource.argtypes=[C.c_void_p];k.LockResource.restype=C.c_void_p
k.SizeofResource.argtypes=[W.HMODULE,C.c_void_p];k.SizeofResource.restype=W.DWORD
CB=C.WINFUNCTYPE(W.BOOL,W.HMODULE,C.c_void_p,C.c_void_p,C.c_ssize_t)
LCB=C.WINFUNCTYPE(W.BOOL,W.HMODULE,C.c_void_p,C.c_void_p,W.WORD,C.c_ssize_t)
k.EnumResourceNamesW.argtypes=[W.HMODULE,C.c_void_p,CB,C.c_ssize_t]
k.EnumResourceLanguagesW.argtypes=[W.HMODULE,C.c_void_p,C.c_void_p,LCB,C.c_ssize_t]
k.BeginUpdateResourceW.argtypes=[W.LPCWSTR,W.BOOL];k.BeginUpdateResourceW.restype=W.HANDLE
k.UpdateResourceW.argtypes=[W.HANDLE,C.c_void_p,C.c_void_p,W.WORD,C.c_void_p,W.DWORD];k.UpdateResourceW.restype=W.BOOL
k.EndUpdateResourceW.argtypes=[W.HANDLE,W.BOOL];k.EndUpdateResourceW.restype=W.BOOL

def ident(v):return v if isinstance(v,int) else C.cast(C.c_wchar_p(v),C.c_void_p)
def groups(file):
 h=k.LoadLibraryExW(str(file),None,0x22)
 if not h:raise C.WinError(C.get_last_error())
 out=[]
 @CB
 def names(module,kind,name,param):
  label=name if name<=65535 else C.wstring_at(name)
  @LCB
  def langs(module,kind,name,lang,param):out.append((label,lang));return True
  k.EnumResourceLanguagesW(h,14,ident(label),langs,0)
  return True
 k.EnumResourceNamesW(h,14,names,0);k.FreeLibrary(h)
 return out

def section_hashes(file):
 b=file.read_bytes();pe=struct.unpack_from('<I',b,0x3c)[0];n=struct.unpack_from('<H',b,pe+6)[0];opt=pe+24;size=struct.unpack_from('<H',b,pe+20)[0];entry=struct.unpack_from('<I',b,opt+16)[0];result={}
 for i in range(n):
  pos=opt+size+i*40;name=b[pos:pos+8].rstrip(b'\0').decode('ascii');length,offset=struct.unpack_from('<II',b,pos+16)
  if name!='.rsrc':result[name]=hashlib.sha256(b[offset:offset+length]).hexdigest()
 return {'entrypoint':entry,'sections':result}

def resource(file,kind,name):
 h=k.LoadLibraryExW(str(file),None,0x22)
 if not h:raise C.WinError(C.get_last_error())
 try:
  r=k.FindResourceW(h,ident(name),kind)
  if not r:raise C.WinError(C.get_last_error())
  return C.string_at(k.LockResource(k.LoadResource(h,r)),k.SizeofResource(h,r))
 finally:k.FreeLibrary(h)

def main():
 before=section_hashes(exe);original_groups=groups(exe);assert original_groups,'Executable has no icon group'
 shutil.copy2(exe,stage);data=ico.read_bytes();reserved,kind,count=struct.unpack_from('<HHH',data);assert (reserved,kind)==(0,1)
 group=struct.pack('<HHH',0,1,count);images=[]
 for i in range(count):
  width,height,colors,reserved,planes,bits,length,offset=struct.unpack_from('<BBBBHHII',data,6+16*i)
  images.append(data[offset:offset+length]);group+=struct.pack('<BBBBHHIH',width,height,colors,reserved,planes,bits,length,i+1)
 update=k.BeginUpdateResourceW(str(stage),False)
 if not update:raise C.WinError(C.get_last_error())
 try:
  for lang in set(lang for _,lang in original_groups):
   for i,blob in enumerate(images,1):
    buf=C.create_string_buffer(blob)
    if not k.UpdateResourceW(update,3,i,lang,buf,len(blob)):raise C.WinError(C.get_last_error())
  for name,lang in original_groups:
   buf=C.create_string_buffer(group)
   if not k.UpdateResourceW(update,14,ident(name),lang,buf,len(group)):raise C.WinError(C.get_last_error())
 except:
  k.EndUpdateResourceW(update,True);raise
 if not k.EndUpdateResourceW(update,False):raise C.WinError(C.get_last_error())
 assert section_hashes(stage)==before,'Unexpected code or non-resource section change'
 for name,_ in original_groups:assert resource(stage,14,name)==group
 for i,blob in enumerate(images,1):assert resource(stage,3,i)==blob
 result={'passed':True,'groups':original_groups,'sizes':count,'nonResourceSectionsUnchanged':True,'entrypointUnchanged':True,'stagedExe':str(stage),'sha256':hashlib.sha256(stage.read_bytes()).hexdigest()}
 (ROOT/'tools/icon-resource-results-20261101.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()

