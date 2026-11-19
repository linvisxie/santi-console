"""从已确认的液态玻璃 PNG 生成 Windows 图标；不重新绘制图案。"""
from pathlib import Path
import shutil
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
SIZES=[16,20,24,32,40,48,64,96,128,256]
def main():
    master=Image.open(ROOT/'assets/santi-liquid-glass-master.png').convert('RGBA')
    assert master.width==master.height
    assert master.getextrema()[3][0]==0,'图标外部必须有真实透明度'
    out=ROOT/'assets/santi-liquid-glass.ico'
    master.save(out,format='ICO',sizes=[(s,s) for s in SIZES])
    for target in [ROOT/'app.ico',ROOT/'runtime/resources/app/icon.ico']:
        shutil.copy2(out,target)
    master.save(ROOT/'runtime/resources/app/public/app-icon.png')
    print('Generated ICO sizes:',sorted(Image.open(out).ico.sizes()))
if __name__=='__main__':main()
