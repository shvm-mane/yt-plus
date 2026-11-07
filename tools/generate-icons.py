# Draws chromium/icons and firefox/icons: a red rounded rectangle with a white plus.
# Usage: python3 tools/generate-icons.py
import pathlib, struct, zlib
RED=(255,0,51)  # YouTube red
def png(n,path):
    ss=6; N=n*ss
    # rounded rectangle in YouTube's proportions; slightly fuller at tiny sizes so it stays legible
    hw=0.5*(0.96 if n<=16 else 0.94); hh=hw*(0.72 if n<=16 else 0.70); r=hh*0.44
    # plus: thicker arms at small sizes
    arm=hh*(0.62 if n<=16 else 0.56); t=hh*(0.17 if n<=16 else 0.125)
    rows=[]
    for y in range(n):
        row=bytearray([0])
        for x in range(n):
            ra=wa=0
            for sy in range(ss):
                for sx in range(ss):
                    u=(x+(sx+.5)/ss)/n-.5; v=(y+(sy+.5)/ss)/n-.5
                    dx=max(abs(u)-(hw-r),0); dy=max(abs(v)-(hh-r),0)
                    if dx*dx+dy*dy<=r*r:
                        ra+=1
                        if (abs(u)<=arm and abs(v)<=t) or (abs(v)<=arm and abs(u)<=t): wa+=1
            tot=ss*ss
            if ra==0: row+=bytes([0,0,0,0]); continue
            w=wa/ra
            row+=bytes([round(RED[i]+(255-RED[i])*w) for i in range(3)]+[round(255*ra/tot)])
        rows.append(bytes(row))
    ch=lambda t,d:struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d))
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'+ch(b'IHDR',struct.pack('>IIBBBBB',n,n,8,6,0,0,0))+ch(b'IDAT',zlib.compress(b''.join(rows),9))+ch(b'IEND',b''))
OUTS = [pathlib.Path(__file__).resolve().parent.parent / d / 'icons' for d in ('chromium', 'firefox')]
for n in (16, 32, 48, 128):
    for out in OUTS:
        png(n, out / f'{n}.png')
