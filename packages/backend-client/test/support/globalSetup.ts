import { execFileSync } from "node:child_process";
import { backendProject } from "./testBackend";

/** Builds the backend once, unless a published binary was given. */
export default function setup(): void {
  const published = process.env["NUGET_VSCODE_BACKEND_PATH"];
  if (published !== undefined && published !== "") {
    return;
  }

  execFileSync("dotnet", ["build", backendProject, "-c", "Debug", "-nologo", "-v:q"], { stdio: "inherit" });
}
