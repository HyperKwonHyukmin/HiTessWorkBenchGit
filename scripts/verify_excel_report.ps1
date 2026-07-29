param(
    [Parameter(Mandatory = $true)]
    [string]$WorkbookPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null

try {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $excel.DisplayAlerts = $false
    $excel.EnableEvents = $false
    $workbook = $excel.Workbooks.Open((Resolve-Path -LiteralPath $WorkbookPath).Path, 0, $true)

    $errors = @()
    $sheets = @()
    foreach ($worksheet in $workbook.Worksheets) {
        $usedRange = $worksheet.UsedRange
        foreach ($cell in $usedRange.Cells) {
            $text = [string]$cell.Text
            if ($text -match '#REF!|#DIV/0!|#VALUE!|#NAME\?|#N/A') {
                $errors += [ordered]@{
                    sheet = [string]$worksheet.Name
                    address = [string]$cell.Address($false, $false)
                    text = $text
                    formula = [string]$cell.Formula
                }
            }
        }
        $sheets += [ordered]@{
            name = [string]$worksheet.Name
            visible = [int]$worksheet.Visible
            usedRange = [string]$usedRange.Address($false, $false)
            printArea = [string]$worksheet.PageSetup.PrintArea
            shapeCount = [int]$worksheet.Shapes.Count
        }
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($usedRange)
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($worksheet)
    }

    $target = $workbook.Worksheets.Item('2027작성본')
    $result = [ordered]@{
        workbook = (Resolve-Path -LiteralPath $WorkbookPath).Path
        sheets = $sheets
        formulaErrors = $errors
        keyValues = [ordered]@{
            title = [string]$target.Range('A1').Text
            period = [string]$target.Range('AA7').Text
            totalHours = [string]$target.Range('AM10').Text
            totalDevelopmentCost = [string]$target.Range('AM11').Text
            financialEffect = [string]$target.Range('X34').Text
            sourceNote = [string]$target.Range('D42').Text
        }
    }
    $result | ConvertTo-Json -Depth 8
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($target)
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
