@echo off
setlocal
chcp 65001 >nul
rem ============================================================
rem  CAI DAT Phan mem quan ly nhan su - BAN DAY DU len Cloudflare
rem  Can: Node.js ban LTS (https://nodejs.org), tai khoan Cloudflare
rem  Cach dung: bam dup file nay (hoac go .\cai-dat.cmd trong PowerShell)
rem ============================================================
cd /d "%~dp0"
where node >nul 2>nul || (echo [Loi] Chua cai Node.js. Tai ban LTS tai https://nodejs.org , cai xong mo lai file nay. & pause & exit /b 1)
echo.
echo 1/5  Cai cong cu wrangler (lan dau mat 1-2 phut)...
call npm install --no-fund --no-audit || goto :err
echo.
echo 2/5  Dang nhap Cloudflare - trinh duyet se mo ra, bam Allow...
call npx wrangler login || goto :err
echo.
echo 3/5  Tao co so du lieu...
node cai-dat.mjs || goto :err
echo.
echo 4/5  Dua phan mem len Cloudflare...
call npx wrangler deploy || goto :err
echo.
echo 5/5  Dat MA CAI DAT (tu 8 ky tu, tu dat, ghi lai - chi dung 1 lan de tao tai khoan quan tri):
call npx wrangler secret put MA_CAI_DAT || goto :err
echo.
echo XONG. Dia chi phan mem la dong "https://...workers.dev" o buoc 4.
echo  - Mo  dia-chi/quan-ly  : nhap ma cai dat, ten cong ty, mat khau quan tri
echo  - Mo  dia-chi/quan-tri : dung phan mem
pause
exit /b 0
:err
echo.
echo [Loi] Cai dat dung giua chung. Chup man hinh nay gui nguoi ho tro.
pause
exit /b 1
