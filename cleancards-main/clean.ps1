$ErrorActionPreference = "Stop"

Write-Host "Cleaning install artifacts..." -ForegroundColor Cyan
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "Starting dev server..." -ForegroundColor Green
npm run dev
