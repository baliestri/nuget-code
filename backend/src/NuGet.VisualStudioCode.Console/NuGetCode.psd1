@{
  RootModule           = 'NuGet.VisualStudioCode.Console.dll'
  ModuleVersion        = '1.0.0'
  GUID                 = '5d0f6a52-6f1c-4e0e-9a55-1b7a6c2f8f31'
  Author               = 'Bruno Sales'
  Copyright            = '(c) Bruno Sales. Licensed under the zlib/libpng License.'
  Description          = 'The cmdlets of the NuGet Package Manager Console of NuGet Manager for VS Code.'
  CompatiblePSEditions = @('Core')
  PowerShellVersion    = '7.6'
  ScriptsToProcess     = @('NuGetCode.Prompt.ps1')
  FormatsToProcess     = @('NuGetCode.format.ps1xml')
  CmdletsToExport      = @(
    'Find-Package'
    'Get-Package'
    'Get-Project'
    'Set-Project'
  )
  FunctionsToExport    = @()
  AliasesToExport      = @()
  VariablesToExport    = @()
}
