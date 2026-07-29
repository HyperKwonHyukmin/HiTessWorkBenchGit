param(
    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null

function Convert-ExcelColorToHex {
    param([object]$ColorValue)
    if ($null -eq $ColorValue -or [double]$ColorValue -lt 0) {
        return $null
    }
    $value = [int64]$ColorValue
    $red = $value -band 0xFF
    $green = ($value -shr 8) -band 0xFF
    $blue = ($value -shr 16) -band 0xFF
    return ('#{0:X2}{1:X2}{2:X2}' -f $red, $green, $blue)
}

try {
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.ScreenUpdating = $false
    $excel.EnableEvents = $false

    $resolvedPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
    $workbook = $excel.Workbooks.Open($resolvedPath, 0, $true)
    $sheetSummaries = @()

    foreach ($worksheet in $workbook.Worksheets) {
        $originalVisibility = [int]$worksheet.Visible
        if ($originalVisibility -ne -1) {
            $worksheet.Visible = -1
        }
        $usedRange = $worksheet.UsedRange
        $cells = @()
        $mergeAreas = [System.Collections.Generic.HashSet[string]]::new()

        foreach ($cell in $usedRange.Cells) {
            $text = [string]$cell.Text
            $formula = [string]$cell.Formula
            if ($cell.MergeCells) {
                [void]$mergeAreas.Add($cell.MergeArea.Address($false, $false))
            }
            if (-not [string]::IsNullOrWhiteSpace($text) -or ($formula -and $formula.StartsWith('='))) {
                $address = $cell.Address($false, $false)
                $cells += [ordered]@{
                    address = $address
                    text = $text
                    value = $cell.Value2
                    formula = $(if ($formula.StartsWith('=')) { $formula } else { $null })
                    style = [ordered]@{
                        fontName = [string]$cell.Font.Name
                        fontSize = [double]$cell.Font.Size
                        bold = [bool]$cell.Font.Bold
                        fontColor = Convert-ExcelColorToHex $cell.Font.Color
                        fillColor = Convert-ExcelColorToHex $cell.Interior.Color
                        horizontalAlignment = [int]$cell.HorizontalAlignment
                        verticalAlignment = [int]$cell.VerticalAlignment
                        wrapText = [bool]$cell.WrapText
                        numberFormat = [string]$cell.NumberFormat
                        rowHeight = [double]$cell.RowHeight
                        columnWidth = [double]$cell.ColumnWidth
                    }
                }
            }
        }

        $shapes = @()
        foreach ($shape in $worksheet.Shapes) {
            $shapes += [ordered]@{
                name = [string]$shape.Name
                type = [int]$shape.Type
                left = [double]$shape.Left
                top = [double]$shape.Top
                width = [double]$shape.Width
                height = [double]$shape.Height
                alternativeText = [string]$shape.AlternativeText
            }
        }

        $previewPath = Join-Path $OutputDirectory (('sheet_{0:00}_{1}.png' -f $worksheet.Index, ($worksheet.Name -replace '[\\/:*?"<>|]', '_')))
        $previewError = $null
        $chartObject = $null
        try {
            $usedRange.CopyPicture(1, 2)
            $previewWidth = [Math]::Min([Math]::Max([double]$usedRange.Width, 400), 5000)
            $previewHeight = [Math]::Min([Math]::Max([double]$usedRange.Height, 300), 10000)
            $chartObject = $worksheet.ChartObjects().Add($usedRange.Left, $usedRange.Top, $previewWidth, $previewHeight)
            $chartObject.Chart.Paste() | Out-Null
            $chartObject.Chart.Export($previewPath, 'PNG') | Out-Null
        }
        catch {
            $previewError = $_.Exception.Message
        }
        finally {
            if ($null -ne $chartObject) {
                $chartObject.Delete()
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($chartObject)
            }
        }

        $pdfPath = Join-Path $OutputDirectory (('sheet_{0:00}_{1}.pdf' -f $worksheet.Index, ($worksheet.Name -replace '[\\/:*?"<>|]', '_')))
        $pdfError = $null
        try {
            $worksheet.ExportAsFixedFormat(0, $pdfPath, 0, $true, $false)
        }
        catch {
            $pdfError = $_.Exception.Message
        }

        $sheetSummaries += [ordered]@{
            index = [int]$worksheet.Index
            name = [string]$worksheet.Name
            visible = [int]$worksheet.Visible
            usedRange = [string]$usedRange.Address($false, $false)
            rowCount = [int]$usedRange.Rows.Count
            columnCount = [int]$usedRange.Columns.Count
            printArea = [string]$worksheet.PageSetup.PrintArea
            mergedAreas = @($mergeAreas)
            cells = $cells
            shapes = $shapes
            preview = $previewPath
            previewError = $previewError
            pdf = $pdfPath
            pdfError = $pdfError
        }

        if ($originalVisibility -ne -1) {
            $worksheet.Visible = $originalVisibility
        }

        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($usedRange)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet)
    }

    $summary = [ordered]@{
        workbook = $resolvedPath
        title = [string]$workbook.BuiltinDocumentProperties('Title').Value
        subject = [string]$workbook.BuiltinDocumentProperties('Subject').Value
        sheetCount = [int]$workbook.Worksheets.Count
        sheets = $sheetSummaries
    }

    $jsonPath = Join-Path $OutputDirectory 'workbook_inspection.json'
    $summary | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding utf8
    Write-Output $jsonPath
}
finally {
    if ($null -ne $workbook) {
        $workbook.Close($false)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook)
    }
    if ($null -ne $excel) {
        $excel.Quit()
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
