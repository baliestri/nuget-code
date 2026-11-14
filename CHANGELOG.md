# NuGet Manager for VSCode Changelog

## [2.0.0](https://github.com/baliestri/nuget-code/compare/v1.1.0..v2.0.0) - 2026-10-01

### ⛰️  Features

- *(client)* Schedule bounded compatibility verification - ([50034b3](https://github.com/baliestri/nuget-code/commit/50034b30d0fa362f8c57f6de11f0a32c99a7f605))
- *(client)* Verify upgrade compatibility with isolated NuGet restore - ([35e25a3](https://github.com/baliestri/nuget-code/commit/35e25a3de0cf931a8997fbd9be0d5a80a6b9c6e8))
- *(client)* Materialize verified compatibility workspaces - ([e253466](https://github.com/baliestri/nuget-code/commit/e253466838ce2db71f3aada3bc2550dd4909620e))
- *(client)* Evaluate bounded project input snapshots - ([118166e](https://github.com/baliestri/nuget-code/commit/118166e5cb5073b8583d6dbae1c40396d892962c))
- *(client)* Share guarded literal version edit plans - ([40780e4](https://github.com/baliestri/nuget-code/commit/40780e440354c794551e589de5a401f549a5e9df))
- *(client)* Load version catalogs from HTTP and local feeds - ([ec1050c](https://github.com/baliestri/nuget-code/commit/ec1050c29812ea64883e28bf28cb43a3450703aa))
- *(client)* Resolve project SDK and execute CLI without a shell - ([fde2c00](https://github.com/baliestri/nuget-code/commit/fde2c00c504a0ed7fce52588ddedd97bc87290be))
- *(extension)* Execute verified package operations - ([7cd3159](https://github.com/baliestri/nuget-code/commit/7cd31597d5db34eb980d941623eb7c777117919f))
- *(manager)* Evaluate upgrades per project and reference - ([1cbc370](https://github.com/baliestri/nuget-code/commit/1cbc370b3a1a7a2dc15ae9b029927cec36af1412))
- *(packages)* Add multifeed browsing and selected updates - ([5e06445](https://github.com/baliestri/nuget-code/commit/5e064450457ee1b9e0459039805f5638a745c009))
- *(release)* Publish validated VSIX to Open VSX - ([566bff2](https://github.com/baliestri/nuget-code/commit/566bff25708260b3013989a5c49f0606b49b60ca))
- *(release)* Promote, publish and recover validated releases - ([36d1cd0](https://github.com/baliestri/nuget-code/commit/36d1cd04d3490c7ab5e7147411e8eb4f4778b66b))
- *(release)* Build and verify a single VSIX - ([d1366bd](https://github.com/baliestri/nuget-code/commit/d1366bdb0dadfdab3972247669394eca78a3f22c))
- *(sources)* Add properties and summary tabs with save settings - ([e114f93](https://github.com/baliestri/nuget-code/commit/e114f93e74aa83d09d324b60b566c8d33a7a0ad3))
- *(sources)* Add guarded NuGet configuration editing - ([92f9fa5](https://github.com/baliestri/nuget-code/commit/92f9fa582f42d4db81435b1a3aabbd4e2a160dbd))
- *(webview)* Explain update compatibility with accessible icons - ([42e790b](https://github.com/baliestri/nuget-code/commit/42e790b731aa08cc486c6eaac7b6e9cd6106914d))

### 🐛 Bug Fixes

- *(ci)* Resolve ShellCheck warnings in release workflows - ([8edc0c1](https://github.com/baliestri/nuget-code/commit/8edc0c144312e31cbe58d316ee270624314e723c))
- *(ci)* Avoid shellcheck warning in job summary - ([0e01c54](https://github.com/baliestri/nuget-code/commit/0e01c54639e913bfed1163cdee99254e6b01a4d0))
- *(client)* Enforce bounded HTTP retries and redirect handling - ([57bf856](https://github.com/baliestri/nuget-code/commit/57bf856e12d04bcb7e51912916be2823deeaa369))
- *(manager)* Compare versions using NuGet precedence - ([90475be](https://github.com/baliestri/nuget-code/commit/90475beefa345fc1dd296a5cfa2c24e0a951256e))
- *(packages)* Allow explicit updates without isolated verification - ([bf4b5bc](https://github.com/baliestri/nuget-code/commit/bf4b5bcb9985b1e5a1107dda13f99e0c3c904dc9))
- *(packages)* Remove duplicate rows and redundant counts - ([6c1cb1f](https://github.com/baliestri/nuget-code/commit/6c1cb1f233a10a3591dfe62ea92059a960853b38))
- *(webview)* Prevent feed filter popup from disappearing - ([442e85b](https://github.com/baliestri/nuget-code/commit/442e85bd737f41996496a32a9bbdacd3fd67a743))
- *(webview)* Prevent compatibility tooltip clipping - ([3bc272b](https://github.com/baliestri/nuget-code/commit/3bc272ba48dc3a37daf81a123f74ee5f61a32bef))
- *(webview)* Preserve package version and feed selections - ([01a319e](https://github.com/baliestri/nuget-code/commit/01a319eb16325a0e936ade69ab971a2331dc66c5))
- *(workspace)* Scope package sources and SDK resolution - ([6594772](https://github.com/baliestri/nuget-code/commit/659477269d0240f12e3ec2df51be83934d2efdac))

### 🚜 Refactor

- *(client)* Collect package references with each project SDK - ([be6dce5](https://github.com/baliestri/nuget-code/commit/be6dce5f63394693580e5bb6afb4de2cbe0c6c3f))
- *(contracts)* Separate inventory catalog and upgrade evidence - ([ba1e67c](https://github.com/baliestri/nuget-code/commit/ba1e67c1f9093f6f27c25de3024a269c0f241aa7))
- *(extension)* Derive update state from scoped package data - ([bb68e85](https://github.com/baliestri/nuget-code/commit/bb68e85d8edc0302cabd62218fd5fb06191359bb))
- *(extension)* Scope asynchronous reads and state revisions - ([fe85b06](https://github.com/baliestri/nuget-code/commit/fe85b0673d8eb713188858117489a4a2b41a45f3))
- *(extension)* Partition and bound persistent package caches - ([a5e6146](https://github.com/baliestri/nuget-code/commit/a5e61460ad47c8073131c6f0b3174ebec8a94e43))

### 📚 Documentation

- *(release)* Document manual review and recovery - ([719f321](https://github.com/baliestri/nuget-code/commit/719f3219e686347bd8f6b09246628c549d560aaf))
- Refresh readmes and interface screenshots - ([6445a03](https://github.com/baliestri/nuget-code/commit/6445a03bcff27e8c6c29cebf21d360015bd431c3))

### ⚡ Performance

- *(client)* Cache package resources by generation - ([f779575](https://github.com/baliestri/nuget-code/commit/f7795759de9b569536c048f2b91a3069eae79ec3))
- *(client)* Bound and deduplicate HTTP requests - ([f141ddb](https://github.com/baliestri/nuget-code/commit/f141ddb652490a54357a60a299ed34a631108dbd))

### 🧪 Testing

- *(client)* Allow more time for compatibility checks on Windows - ([d075122](https://github.com/baliestri/nuget-code/commit/d0751225d96eb25cb345a9f8ec08eabe31276ffe))
- *(client)* Prove compatibility isolation with shared edits - ([e687238](https://github.com/baliestri/nuget-code/commit/e6872386e77a33e5eaf701112d5315eef1b65142))
- *(client)* Add SDK fixtures and a NuGet version oracle - ([1ea91ae](https://github.com/baliestri/nuget-code/commit/1ea91ae2369e2fe10ba57ab6243d8e60add055e7))
- *(extension)* Validate scoped data with real SDKs - ([e415f58](https://github.com/baliestri/nuget-code/commit/e415f581d12bf42481b352a8851e00cd335b2a66))
- Run all workspace package suites - ([0abeaad](https://github.com/baliestri/nuget-code/commit/0abeaadccb24d3a11dd1bef418e0e43e048a24cd))

### ⚙️ Miscellaneous Tasks

- *(release)* Prepare v2.0.0 - ([157dd41](https://github.com/baliestri/nuget-code/commit/157dd412cf1f671ef201433c33aca60c7e7de120))
- Validate .NET SDK 8 9 and 10 on Windows and Linux - ([ed729fe](https://github.com/baliestri/nuget-code/commit/ed729fe5587722a7098cbfc34572a32aeef4c511))
- Validate builds and tests on Windows and Linux - ([62b8037](https://github.com/baliestri/nuget-code/commit/62b8037ebf99e269f134469ac430222539369f4f))

## [1.1.0] - 2026-08-15

### ⛰️  Features

- *(client)* Implement NuGet client services - ([3c934fa](https://github.com/baliestri/nuget-code/commit/3c934fae95f95dafe91b8ff9aff237e4d496998f))
- *(contracts)* Define package manager protocol - ([42307da](https://github.com/baliestri/nuget-code/commit/42307da69a09cbf5c036b96692070944e3b01666))
- *(extension)* Add multi-solution discovery and active solution selection - ([bf8383d](https://github.com/baliestri/nuget-code/commit/bf8383d32a388feaf8e1933d26ff72b6c0f7e425))
- *(extension)* Add logo image for the extension - ([110a0d8](https://github.com/baliestri/nuget-code/commit/110a0d8e40689b25b1525154345fd76cf1c79a34))
- *(extension)* Add license and readme files - ([fa347da](https://github.com/baliestri/nuget-code/commit/fa347dae5875cd0a2e1b22b9e5a73f8ee613c33b))
- *(extension)* Update package version and repository details - ([f610445](https://github.com/baliestri/nuget-code/commit/f610445b2f9b27dc7c1ba965a293b565cfc9d497))
- *(extension)* Add NuGet package manager backend - ([5103099](https://github.com/baliestri/nuget-code/commit/5103099b81a7ac737a293fccc854e91b3ddb421d))
- *(manager)* Add package management core - ([173506b](https://github.com/baliestri/nuget-code/commit/173506b7c9c913dc756113eb5e9353f7b805b210))
- *(webview)* Build package manager interface - ([71e36d9](https://github.com/baliestri/nuget-code/commit/71e36d9b60cef5a0d29961f732e94b214d807b36))

### 🐛 Bug Fixes

- *(build)* Stop webview compile from wiping the shared extension dist dir - ([3f34a70](https://github.com/baliestri/nuget-code/commit/3f34a70c22dc43023b514fee720bc7affa0c79d4))
- *(ci)* Read bumped version from package.json instead of pnpm version stdout - ([282202c](https://github.com/baliestri/nuget-code/commit/282202cf9db4688544efdb136b53eeddebd63d39))
- *(client)* Retry dotnet list package unconditionally and surface listing failures - ([b32618b](https://github.com/baliestri/nuget-code/commit/b32618b87ec72c728c5d91ea8d39efd8efedbd36))
- *(extension)* Make discovery tests platform-independent - ([f4daa38](https://github.com/baliestri/nuget-code/commit/f4daa38d2c2cadab0aa6793652bb492e2962b6f0))
- *(extension)* Scope TargetSelect to the active solution's own projects - ([a3c16de](https://github.com/baliestri/nuget-code/commit/a3c16de275bc97657da9ac03b1a5f418cab27f77))
- *(extension)* Re-run workspace discovery on project/solution add or remove - ([083ec44](https://github.com/baliestri/nuget-code/commit/083ec44b5659823b003f01631867d3b6752acc57))
- *(extension)* Correct display name in package.json - ([91fe764](https://github.com/baliestri/nuget-code/commit/91fe7642eca4e0a04ce834e3f3c55a6891adaee6))
- *(nuget.cli)* Retry dotnet list package with --no-restore on restore failure - ([b8a34af](https://github.com/baliestri/nuget-code/commit/b8a34af257fe326205307e164653947f304c8ab3))

### 🚜 Refactor

- *(extension)* Move dependencies to devDependencies - ([edcfce8](https://github.com/baliestri/nuget-code/commit/edcfce8a04de84b98a5b81de3f52f0691841e953))

### 📚 Documentation

- *(extension)* Update image links in README for proper display - ([622b8ba](https://github.com/baliestri/nuget-code/commit/622b8baf0e063a626e12067ac36e812cf4f2b6ff))
- *(readme)* Document package manager features - ([20760b0](https://github.com/baliestri/nuget-code/commit/20760b0a8badb90a3b1df62a29a1632b83a76373))

### 🎨 Styling

- *(client)* Reformat package inventory test for linter compliance - ([0349201](https://github.com/baliestri/nuget-code/commit/034920120115f8253c6599f94bdf1d4528f3c096))

### ⚙️ Miscellaneous Tasks

- *(extension)* Release v1.1.0 - ([6ab2ea7](https://github.com/baliestri/nuget-code/commit/6ab2ea7cd1b3f30f8dd2bf06b6f630cdeef5615d))
- *(extension)* Release v1.1.0 - ([915d383](https://github.com/baliestri/nuget-code/commit/915d3830dce50026e099159b03d34be32a8c4f24))
- *(project)* Add license and test tooling - ([90f1e2d](https://github.com/baliestri/nuget-code/commit/90f1e2d4ed68015544925594a83a520f3ba9b357))
- *(release)* Add automated develop->main release workflow - ([96daeec](https://github.com/baliestri/nuget-code/commit/96daeec0cf98bd6c3a8228fc418d04b64d2874b5))
- Create packages structure - ([f4f4943](https://github.com/baliestri/nuget-code/commit/f4f4943e4f95910beaff3dc9224f46c97e59ef3a))

## New Contributors ❤️

* @github-actions[bot] made their first contribution in [#11](https://github.com/baliestri/nuget-code/pull/11)
