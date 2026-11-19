param([string]$InputPath,[string]$OutputPath)
$ErrorActionPreference='Stop'
$application=$null
$document=$null
$extension=[IO.Path]::GetExtension($InputPath).ToLowerInvariant()
$hadOfficeProcess=@(Get-Process wps,et,wpp -ErrorAction SilentlyContinue).Count -gt 0
try {
 if($extension -eq '.docx') {
  $application=New-Object -ComObject KWPS.Application
  $application.Visible=$false
  $application.AutomationSecurity=3
  $document=$application.Documents.Open($InputPath,$false,$true)
  $document.ExportAsFixedFormat($OutputPath,17)
 } elseif($extension -eq '.xlsx') {
  $application=New-Object -ComObject KET.Application
  $application.Visible=$false
  $application.AutomationSecurity=3
  $document=$application.Workbooks.Open($InputPath,0,$true)
  $document.ExportAsFixedFormat(0,$OutputPath)
 } elseif($extension -eq '.pptx') {
  $application=New-Object -ComObject KWPP.Application
  $application.AutomationSecurity=3
  $document=$application.Presentations.Open($InputPath,-1,0,0)
  $document.SaveAs($OutputPath,32)
 } else { throw 'Unsupported Office format' }
 if(!(Test-Path -LiteralPath $OutputPath)){throw 'No PDF produced'}
} finally {
 if($document){try{if($extension -eq '.docx'){$document.Close(0)}elseif($extension -eq '.xlsx'){$document.Close($false)}else{$document.Close()}}catch{}}
 if($application -and !$hadOfficeProcess){try{$application.Quit()}catch{}}
 if($document){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($document)}
 if($application){[void][Runtime.InteropServices.Marshal]::ReleaseComObject($application)}
}
