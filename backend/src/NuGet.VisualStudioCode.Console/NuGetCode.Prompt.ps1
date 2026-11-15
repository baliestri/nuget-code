# Runs in the session that imports the module: the prompt names the default project of the console.
function global:prompt {
  [NuGet.VisualStudioCode.Console.ConsoleSession]::Prompt
}
