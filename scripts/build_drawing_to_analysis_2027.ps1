param(
    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath,
    [Parameter(Mandatory = $true)]
    [string]$PreviewPdfPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
$worksheet = $null

function Get-Rgb {
    param([int]$Red, [int]$Green, [int]$Blue)
    return $Red + (256 * $Green) + (65536 * $Blue)
}

function Set-CellValue {
    param(
        [object]$Sheet,
        [string]$Address,
        [object]$Value,
        [double]$FontSize = 0,
        [bool]$Bold = $false
    )
    $cell = $Sheet.Range($Address)
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int32] -or $Value -is [int64] -or $Value -is [single] -or $Value -is [double] -or $Value -is [decimal]) {
        $cell.Value2 = [double]$Value
    }
    else {
        $cell.Value2 = [string]$Value
    }
    if ($FontSize -gt 0) {
        $cell.Font.Size = $FontSize
    }
    $cell.Font.Bold = $Bold
    $cell.WrapText = $true
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($cell)
}

function Add-PipelineBox {
    param(
        [object]$Sheet,
        [double]$Left,
        [double]$Top,
        [double]$Width,
        [double]$Height,
        [string]$Text,
        [int]$FillColor
    )
    $shape = $Sheet.Shapes.AddShape(5, $Left, $Top, $Width, $Height)
    $shape.Fill.ForeColor.RGB = $FillColor
    $shape.Line.ForeColor.RGB = Get-Rgb 31 78 121
    $shape.Line.Weight = 1.25
    $shape.TextFrame2.TextRange.Text = $Text
    $shape.TextFrame2.TextRange.Font.Name = '맑은 고딕'
    $shape.TextFrame2.TextRange.Font.Size = 9
    $shape.TextFrame2.TextRange.Font.Bold = $true
    $shape.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = Get-Rgb 255 255 255
    $shape.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    $shape.TextFrame2.VerticalAnchor = 3
    $shape.TextFrame2.MarginLeft = 4
    $shape.TextFrame2.MarginRight = 4
    return $shape
}

try {
    $resolvedPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
    $previewDirectory = Split-Path -Parent $PreviewPdfPath
    New-Item -ItemType Directory -Path $previewDirectory -Force | Out-Null

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false
    $excel.EnableEvents = $false
    $excel.AskToUpdateLinks = $false

    $workbook = $excel.Workbooks.Open($resolvedPath, 0, $false)
    try {
        $worksheet = $workbook.Worksheets.Item('2027작성본')
    }
    catch {
        $worksheet = $workbook.Worksheets.Item('C2025074')
        $worksheet.Name = '2027작성본'
    }

    $templateWorksheet = $workbook.Worksheets.Item('서식2')
    Set-CellValue $templateWorksheet 'AA12' '- 없음' 10 $false
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($templateWorksheet)

    $worksheet.Tab.Color = Get-Rgb 31 78 121

    for ($index = $worksheet.Shapes.Count; $index -ge 1; $index--) {
        $shapeToDelete = $worksheet.Shapes.Item($index)
        $shapeToDelete.Delete()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shapeToDelete)
    }

    Set-CellValue $worksheet 'A1' '치공구 디지털 구조해석 자동화 플랫폼' 18 $true
    Set-CellValue $worksheet 'D4' '신규' 10 $false
    Set-CellValue $worksheet 'N4' 'E.지능형 설계' 10 $false
    Set-CellValue $worksheet 'N5' 'E01. AI/DT 기술 설계 적용_설계/해석 자동화 및 최적화' 7.5 $false
    Set-CellValue $worksheet 'AA4' '구조시스템연구실' 10 $false
    Set-CellValue $worksheet 'AL4' '권혁민 책임연구원' 10 $false
    Set-CellValue $worksheet 'AA5' '건조기술기획부' 10 $false
    Set-CellValue $worksheet 'G6' 'TRL4: 실험실 규모 핵심기능 검증 및 기준모델 비교' 9 $false
    Set-CellValue $worksheet 'G7' 'TRL7: 실제 치공구 도면 기반 현장 실증 및 성능 검증' 9 $false
    Set-CellValue $worksheet 'AA6' '협의' 10 $false
    Set-CellValue $worksheet 'AN6' '협의' 10 $false
    Set-CellValue $worksheet 'AA7' '2027.01 ~ 2027.12 (12개월)' 10 $false
    Set-CellValue $worksheet 'AL7' '조선' 10 $false

    $purpose = @'
- 치공구 구조해석은 2D 설계도면 해석, 형상 이상화, 재질·접합·하중·구속조건 입력을 해석자가 수작업으로 수행하여 많은 공수와 개인별 편차가 발생함.
- PDF/DWG 도면에서 부재 형상, 치수, 재질, 용접·볼트 접합 정보를 인식하고 구조·연결 관계를 해석 의미모델(Engineering Semantic Model)로 변환하는 기술 개발.
- 의미모델을 기반으로 Beam/Shell 이상화, 메시, 하중·경계조건 템플릿, Nastran 입력모델을 자동 생성하고 강도·변형·좌굴·접합부 안전성을 평가.
- HiTESS WorkBench의 File-Based App인 DrawingToAnalysis로 통합하여 신뢰도 기반 엔지니어 검토, 추론 근거·수정이력 관리 및 안전성 보고서 자동생성 기능 구현.
'@
    Set-CellValue $worksheet 'D8' $purpose.Trim() 9 $false

    Set-CellValue $worksheet 'AA8' '~2026년' 9 $true
    Set-CellValue $worksheet 'AE8' '당해(2027년)' 9 $true
    Set-CellValue $worksheet 'AI8' '(2028년~)' 9 $true
    Set-CellValue $worksheet 'AM8' '전체(총)' 9 $true

    foreach ($address in @('AA9', 'AI9', 'AA10', 'AI10')) {
        Set-CellValue $worksheet $address 0 10 $false
    }
    Set-CellValue $worksheet 'AE9' 0.1 10 $false
    Set-CellValue $worksheet 'AE10' 2100 10 $false
    $worksheet.Range('AM9').Formula = '=SUM(AA9,AE9,AI9)'
    $worksheet.Range('AA11').Formula = '=AA9+AA10*71807/100000000'
    $worksheet.Range('AE11').Formula = '=AE9+AE10*71807/100000000'
    $worksheet.Range('AI11').Formula = '=AI9+AI10*71807/100000000'
    $worksheet.Range('AM10').Formula = '=SUM(AA10,AE10,AI10)'
    $worksheet.Range('AM11').Formula = '=SUM(AA11,AE11,AI11)'
    $worksheet.Range('AA9:AP9').NumberFormat = '0.0'
    $worksheet.Range('AA10:AP10').NumberFormat = '#,##0'
    $worksheet.Range('AA11:AP11').NumberFormat = '0.0'
    Set-CellValue $worksheet 'AA12' '도면 정답데이터 구축·검증 및 실증용 컴퓨팅/소프트웨어 비용: 0.1억원' 9 $false

    $scheduleRows = @(
        @('AA16', '대상 치공구 유형 정의 및 도면-해석 정답 데이터셋 구축', 'AL16', '27.01~27.03', 'AO16', 400),
        @('AA17', '도면 요소·치수·재질·접합부 인식 및 해석 의미모델 생성', 'AL17', '27.04~27.06', 'AO17', 700),
        @('AA18', 'Beam/Shell 이상화·하중/경계조건·Nastran 해석/평가 자동화', 'AL18', '27.07~27.10', 'AO18', 650),
        @('AA19', 'DrawingToAnalysis 앱 통합, 현장 실증 및 V&V', 'AL19', '27.11~27.12', 'AO19', 350)
    )
    foreach ($item in $scheduleRows) {
        Set-CellValue $worksheet $item[0] $item[1] 8.5 $false
        Set-CellValue $worksheet $item[2] $item[3] 8.5 $false
        Set-CellValue $worksheet $item[4] $item[5] 9 $false
    }
    $worksheet.Range('AO16:AP19').NumberFormat = '#,##0'

    $competitor = @'
- 상용 CAD/CAE는 3D CAD 불러오기·메시 자동화 기능을 제공하나, 국내 치공구 2D 도면을 해석 가능한 모델과 안전성 판정으로 직접 변환하는 기능은 제한적임.
- 최신 2D→3D 연구도 도면 모호성, 접합 의미 해석, 실제 도면 일반화 및 검증 추적성 확보가 주요 과제로 남아 있음.
'@
    Set-CellValue $worksheet 'D18' $competitor.Trim() 8.5 $false

    $differentiation = @'
- 사내 치공구 도면·해석 이력 기반 도메인 스키마와 표준 해석 템플릿
- 결정론적 규칙 우선 + 멀티모달 AI 보조 + 신뢰도 임계값 기반 검토
- 기존 Nastran/WorkBench 연계 및 입력·수정·판정 근거의 전 과정 추적
'@
    Set-CellValue $worksheet 'O18' $differentiation.Trim() 8.5 $false

    Set-CellValue $worksheet 'AE22' '재료비 직접 절감: 미산정' 9 $false
    $worksheet.Range('AK22').Formula = '="총 개발비용 : "&TEXT(AM11,"0.0")&"억원"'
    $worksheet.Range('AK22').Font.Size = 9
    Set-CellValue $worksheet 'AE25' '분석·모델링 공수 절감: 0.8억원/년' 9 $false
    Set-CellValue $worksheet 'AK25' '- 해당 사항 없음' 9 $false
    Set-CellValue $worksheet 'AE28' '재작업·품질실패 예방: 0.2억원/년' 9 $false
    Set-CellValue $worksheet 'AK28' '- 해당 사항 없음' 9 $false

    $technicalEffects = @'
- 도면→해석모델→안전성 보고서 전 과정 표준화 및 근거·수정이력 100% 추적
- 모델링 시간 70% 이상 절감, 자동 모델 생성 성공률 85% 이상
- 기준해석 대비 주요 응답 오차 10% 이내, 안전/불안전 판정 일치율 95% 이상
'@
    Set-CellValue $worksheet 'AA31' $technicalEffects.Trim() 8.5 $true

    $financialBasis = @'
연간 재무적 절감 : 1.0억원/년
- 기존 80MH/건 → 목표 24MH/건(70% 절감), 연 20건 기준
  : 56MH × 20건 × 71,807원 = 0.80억원/년
- 모델링 오류에 따른 재해석·재작업 예방 : 0.20억원/년
- 개발비 약 1.61억원, 단순 회수기간 약 1.6년
※ 실제 효과는 2027년 실증 건수와 기준공수 측정 후 확정
'@
    Set-CellValue $worksheet 'X34' $financialBasis.Trim() 9 $false

    $roles = @'
- 구조시스템연구실: 도면 인식, 해석 의미모델, FEM 생성·안전성 평가 엔진 개발 및 V&V
- 건조기술기획부/생산설계 수요부서: 대표 도면 제공, 하중·경계조건 검토, 현장 실증 및 효과 측정
'@
    Set-CellValue $worksheet 'D36' $roles.Trim() 9 $false

    $related = '[C2024011] 선박 의장품 설계 및 해석 자동화 시스템 기술 개발 / HiTESS WorkBench DrawingToAnalysis 선행개발'
    Set-CellValue $worksheet 'D40' $related 8.5 $false

    $sourceArea = $worksheet.Range('A42:AP46')
    if ($sourceArea.MergeCells) { $sourceArea.UnMerge() }
    $sourceLabel = $worksheet.Range('A42:C46')
    if (-not $sourceLabel.MergeCells) { $sourceLabel.Merge($false) }
    $sourceText = $worksheet.Range('D42:AP46')
    if (-not $sourceText.MergeCells) { $sourceText.Merge($false) }
    $worksheet.Range('A42').Value2 = "기술동향`n근거"
    $sourceLabel.Interior.Color = Get-Rgb 218 238 243
    $sourceLabel.Font.Name = '맑은 고딕'
    $sourceLabel.Font.Size = 8
    $sourceLabel.Font.Bold = $true
    $sourceLabel.Font.Color = Get-Rgb 31 31 31
    $sourceLabel.HorizontalAlignment = -4108
    $sourceLabel.VerticalAlignment = -4108
    $worksheet.Range('D42').Value2 = @'
국가과학기술자문회의, 2027년도 국가연구개발 투자방향: https://gbtis.re.kr/file/readFile.tc?fileId=FL00000002407&fileNo=1
NIST, Digital Twins for Advanced Manufacturing (V&V·불확실성·추적성): https://www.nist.gov/programs-projects/digital-twins-advanced-manufacturing
Khan et al. (2026), 2D 도면 주석-3D CAD 특성 매핑: https://arxiv.org/abs/2602.18296
'@
    $sourceText.Font.Name = '맑은 고딕'
    $sourceText.Font.Size = 7
    $sourceText.Font.Color = Get-Rgb 64 64 64
    $sourceText.Interior.Color = Get-Rgb 255 255 255
    $sourceText.WrapText = $true
    $sourceText.HorizontalAlignment = -4131
    $sourceText.VerticalAlignment = -4108
    foreach ($range in @($sourceLabel, $sourceText)) {
        foreach ($borderId in @(7, 8, 9, 10)) {
            $range.Borders.Item($borderId).LineStyle = 1
            $range.Borders.Item($borderId).Weight = 2
            $range.Borders.Item($borderId).Color = Get-Rgb 128 128 128
        }
    }
    $worksheet.Rows('42:46').Hidden = $false
    $worksheet.Rows('42:46').RowHeight = 12

    $pipelineArea = $worksheet.Range('D24:T35')
    $left = [double]$pipelineArea.Left
    $top = [double]$pipelineArea.Top
    $width = [double]$pipelineArea.Width
    $height = [double]$pipelineArea.Height

    $titleBox = $worksheet.Shapes.AddTextbox(1, $left, $top + 2, $width, 18)
    $titleBox.TextFrame2.TextRange.Text = 'DrawingToAnalysis 자동화 파이프라인'
    $titleBox.TextFrame2.TextRange.Font.Name = '맑은 고딕'
    $titleBox.TextFrame2.TextRange.Font.Size = 10
    $titleBox.TextFrame2.TextRange.Font.Bold = $true
    $titleBox.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = Get-Rgb 31 78 121
    $titleBox.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    $titleBox.Line.Visible = 0
    $titleBox.Fill.Visible = 0

    $boxTop = $top + 27
    $boxHeight = [Math]::Min(58, $height * 0.42)
    $gap = 23
    $boxWidth = ($width - (4 * $gap)) / 5
    $boxTexts = @(
        "1. 도면 입력`nPDF / DWG",
        "2. 요소 인식`n치수·재질·접합",
        "3. 의미모델`n형상·연결·속성",
        "4. FEM 자동생성`nBeam / Shell / BC",
        "5. 검증·보고`nNastran / 안전성"
    )
    $boxColors = @(
        (Get-Rgb 31 78 121),
        (Get-Rgb 47 117 181),
        (Get-Rgb 42 157 143),
        (Get-Rgb 36 129 139),
        (Get-Rgb 31 78 121)
    )
    $pipelineShapes = @()
    for ($i = 0; $i -lt 5; $i++) {
        $boxLeft = $left + ($i * ($boxWidth + $gap))
        $pipelineShapes += Add-PipelineBox $worksheet $boxLeft $boxTop $boxWidth $boxHeight $boxTexts[$i] $boxColors[$i]
        if ($i -lt 4) {
            $lineStartX = $boxLeft + $boxWidth + 3
            $lineEndX = $boxLeft + $boxWidth + $gap - 3
            $lineY = $boxTop + ($boxHeight / 2)
            $arrow = $worksheet.Shapes.AddLine($lineStartX, $lineY, $lineEndX, $lineY)
            $arrow.Line.ForeColor.RGB = Get-Rgb 89 89 89
            $arrow.Line.Weight = 1.5
            $arrow.Line.EndArrowheadStyle = 3
            $pipelineShapes += $arrow
        }
    }

    $bannerTop = $boxTop + $boxHeight + 18
    $bannerHeight = [Math]::Min(38, $top + $height - $bannerTop - 4)
    $banner = $worksheet.Shapes.AddShape(5, $left + 12, $bannerTop, $width - 24, $bannerHeight)
    $banner.Fill.ForeColor.RGB = Get-Rgb 218 238 243
    $banner.Line.ForeColor.RGB = Get-Rgb 127 127 127
    $banner.Line.DashStyle = 4
    $banner.TextFrame2.TextRange.Text = '결정론적 규칙 우선  ·  신뢰도 기반 엔지니어 검토  ·  V&V 및 변경이력 추적  ·  WorkBench 통합'
    $banner.TextFrame2.TextRange.Font.Name = '맑은 고딕'
    $banner.TextFrame2.TextRange.Font.Size = 8.5
    $banner.TextFrame2.TextRange.Font.Bold = $true
    $banner.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = Get-Rgb 31 78 121
    $banner.TextFrame2.TextRange.ParagraphFormat.Alignment = 2
    $banner.TextFrame2.VerticalAnchor = 3

    foreach ($shape in $pipelineShapes) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shape)
    }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($banner)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($titleBox)
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($pipelineArea)

    $worksheet.Range('A1:AP46').Font.Name = '맑은 고딕'
    $worksheet.Range('D8:T17').VerticalAlignment = -4160
    $worksheet.Range('D18:T23').VerticalAlignment = -4160
    $worksheet.Range('AA16:AP19').VerticalAlignment = -4108
    $worksheet.Range('X34:AP41').VerticalAlignment = -4108
    $worksheet.PageSetup.PrintArea = '$A$1:$AP$46'
    $worksheet.PageSetup.Zoom = $false
    $worksheet.PageSetup.FitToPagesWide = 1
    $worksheet.PageSetup.FitToPagesTall = 1
    $worksheet.PageSetup.Orientation = 2
    $worksheet.PageSetup.CenterHorizontally = $true
    $worksheet.PageSetup.CenterVertically = $false

    $excel.Calculation = -4105
    $excel.CalculateFull()
    $worksheet.Activate()
    $workbook.Save()
    $worksheet.ExportAsFixedFormat(0, $PreviewPdfPath, 0, $true, $false)

    Write-Output $resolvedPath
    Write-Output $PreviewPdfPath
}
catch {
    Write-Error ($_.Exception.Message + "`n" + $_.InvocationInfo.PositionMessage + "`n" + $_.ScriptStackTrace)
    throw
}
finally {
    if ($null -ne $workbook) {
        $workbook.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)
    }
    if ($null -ne $worksheet) {
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet)
    }
    if ($null -ne $excel) {
        $excel.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
