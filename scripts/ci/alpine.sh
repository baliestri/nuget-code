#!/bin/sh
# Publishes the backend for musl and tests it, inside an Alpine container:
#
#   docker run --rm -v "$PWD:/work" -w /work mcr.microsoft.com/dotnet/sdk:10.0-alpine sh scripts/ci/alpine.sh <rid>
#
# The work happens in a copy inside the container, so the node_modules installed here, which hold musl
# binaries, never reach the runner's checkout. Only the published executable is copied back, to alpine-out/.
set -eu

rid="$1"

apk add --no-cache bash curl clang build-base zlib-dev icu-libs nodejs npm

mkdir /build
cd /work
tar --exclude=./node_modules --exclude=./.git -cf - . | tar -xf - -C /build
cd /build

# The SDK the repository pins, whatever patch the image ships.
curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
bash /tmp/dotnet-install.sh --jsonfile backend/global.json --install-dir /usr/share/dotnet

npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
pnpm install --frozen-lockfile

dotnet publish backend/src/NuGet.VisualStudioCode -c Release -r "$rid" -nologo
NUGET_VSCODE_BACKEND_PATH="/build/backend/src/NuGet.VisualStudioCode/bin/Release/net10.0/$rid/publish/NuGet.VisualStudioCode"
export NUGET_VSCODE_BACKEND_PATH

(
  cd backend
  dotnet test --project tests/NuGet.VisualStudioCode.Tests
  dotnet test --project tests/NuGet.VisualStudioCode.AotTests
  # The image has no PowerShell: the tests of the cmdlets say so and are skipped; the others run.
  dotnet test --project tests/NuGet.VisualStudioCode.Console.Tests
)
pnpm --filter @nuget-code/backend-client test

mkdir -p /work/alpine-out
cp "$NUGET_VSCODE_BACKEND_PATH" /work/alpine-out/
