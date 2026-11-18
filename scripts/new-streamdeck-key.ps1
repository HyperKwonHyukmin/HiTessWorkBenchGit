#Requires -Version 7
<#
스트림덱 'WB Sign-ups' 키의 열쇠 만들기 — 가입 승인 대기 숫자 하나만 읽는 전용 열쇠.

  pwsh scripts/new-streamdeck-key.ps1

- 열쇠 원문은 화면에 찍지 않고 **클립보드에만** 넣는다 → 스트림덱 키 설정 칸 '열쇠'에 붙여 넣는다.
- 화면에는 서버 .env 에 넣을 해시 줄만 찍는다(해시로는 열쇠를 되살릴 수 없다).
    ADMIN_CONSOLE_STREAMDECK_KEY_SHA256=<64자>
  145 백엔드 .env 에 이 줄을 넣고 서버 관리자 창을 닫았다 다시 연다(⟳ Update 는 .env 를 다시 읽지 않는다).
- 다시 실행하면 새 열쇠가 된다. 옛 열쇠는 .env 해시를 바꾸는 순간 막힌다.
계획: docs/plans/2026-11-18-admin-web-console-plan.md
#>
$ErrorActionPreference = 'Stop'

$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$key = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($key))).ToLower()

Set-Clipboard -Value $key
$key = $null

Write-Host '열쇠 원문을 클립보드에 넣었습니다 → 스트림덱 WB Sign-ups 키 설정의 [열쇠] 칸에 붙여 넣으세요.'
Write-Host '145 백엔드 .env 에 넣을 줄:'
Write-Host "ADMIN_CONSOLE_STREAMDECK_KEY_SHA256=$hash"
