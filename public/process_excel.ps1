param (
    [string]$ExcelFile
)

if (-not $ExcelFile) {
    Write-Host "Error: No Excel file specified"
    Write-Host "Usage: process_excel.ps1 C:\path\to\excel\file.xlsx"
    exit 1
}

try {
    $Excel = New-Object -ComObject Excel.Application
    $Excel.Visible = $false
    $Excel.DisplayAlerts = $false
    
    $Workbook = $Excel.Workbooks.Open($ExcelFile)
    $Workbook.Save()
    $Workbook.Close($true)
    
    $Excel.Quit()
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($Workbook) | Out-Null
    [System.Runtime.Interopservices.Marshal]::ReleaseComObject($Excel) | Out-Null
    [System.GC]::Collect()
    
    Write-Host "Excel file processed successfully: $ExcelFile"
    exit 0
} catch {
    Write-Host "Error processing Excel file: $_"
    exit 1
}