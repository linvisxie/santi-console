$ErrorActionPreference='Stop'
$testDirectory='D:\santi-console\tools\.qa-completion-20261101\office'
New-Item -ItemType Directory -Path $testDirectory -Force | Out-Null
$results=@()
foreach($kind in @('docx','xlsx','pptx')) {
 $app=$null;$doc=$null
 try {
  if($kind -eq 'docx'){$app=New-Object -ComObject KWPS.Application;$app.Visible=$false;$doc=$app.Documents.Add();$doc.Content.Text='Santi Office preview acceptance';$doc.SaveAs([IO.Path]::Combine($testDirectory,'sample.docx'),16);$doc.Close(0)}
  elseif($kind -eq 'xlsx'){$app=New-Object -ComObject KET.Application;$app.Visible=$false;$doc=$app.Workbooks.Add();$doc.ActiveSheet.Cells.Item(1,1).Value2='Santi spreadsheet acceptance';$doc.SaveAs([IO.Path]::Combine($testDirectory,'sample.xlsx'),51);$doc.Close($false)}
  else{$app=New-Object -ComObject KWPP.Application;$doc=$app.Presentations.Add();$slide=$doc.Slides.Add(1,12);$shape=$slide.Shapes.AddTextbox(1,40,50,600,100);$shape.TextFrame.TextRange.Text='Santi slide acceptance';$doc.SaveAs([IO.Path]::Combine($testDirectory,'sample.pptx'),24);$doc.Close()}
  $app.Quit();$app=$null;$doc=$null
  & powershell.exe -NoProfile -NonInteractive -File 'D:\santi-console\runtime\resources\app\lib\office-preview.ps1' -InputPath ([IO.Path]::Combine($testDirectory,"sample.$kind")) -OutputPath ([IO.Path]::Combine($testDirectory,"$kind.pdf"))
  $passed=($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath ([IO.Path]::Combine($testDirectory,"$kind.pdf")))
  $results+=@{kind=$kind;passed=$passed}
 } catch { $results+=@{kind=$kind;passed=$false;error=$_.Exception.Message} }
 finally {if($doc){try{$doc.Close()}catch{}};if($app){try{$app.Quit()}catch{}}}
}
$results | ConvertTo-Json | Set-Content -LiteralPath 'D:\santi-console\tools\office-native-results-20261101.json' -Encoding utf8
$results | ConvertTo-Json -Compress
