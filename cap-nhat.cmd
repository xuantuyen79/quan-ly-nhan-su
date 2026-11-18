@echo off
setlocal
chcp 65001 >nul
rem ============================================================
rem  CAP NHAT Phan mem quan ly nhan su - ban day du (du lieu giu nguyen)
rem  Truoc khi chay: tai ban sao luu trong phan mem (Cai dat - Du lieu va sao luu)
rem ============================================================
cd /d "%~dp0"
where node >nul 2>nul || (echo [Loi] Chua cai Node.js. Tai ban LTS tai https://nodejs.org & pause & exit /b 1)
echo 1/3  Cap nhat cong cu...
call npm install --no-fund --no-audit || goto :err
echo 2/3  Kiem tra co so du lieu...
node cai-dat.mjs || goto :err
echo 3/3  Dua ban moi len Cloudflare...
call npx wrangler deploy || goto :err
echo.
echo XONG. Mo lai trang quan tri, bam Ctrl+F5.
pause
exit /b 0
:err
echo [Loi] Cap nhat dung giua chung. Du lieu tren may chu khong bi anh huong. Chup man hinh gui nguoi ho tro.
pause
exit /b 1
