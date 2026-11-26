# NuGet Manager for VSCode Changelog

## [3.1.1](https://github.com/baliestri/nuget-code/compare/v3.1.0..v3.1.1) - 2026-11-26

### 📚 Documentation

- *(contributing)* Describe the signing of the Windows backends - ([4db2a76](https://github.com/baliestri/nuget-code/commit/4db2a7635f2df24b33d3aa91701bc90cc07f9aee))

### ⚙️ Miscellaneous Tasks

- *(release)* Sign the Windows backends with SSL.com eSigner - ([cf81da3](https://github.com/baliestri/nuget-code/commit/cf81da38f5d3ab7685dd503fc698211f2e8eb0d0))

## [3.1.0](https://github.com/baliestri/nuget-code/compare/v3.0.0..v3.1.0) - 2026-11-17

### ⛰️  Features

- *(extension)* Ask for a GitHub star after fifteen days of use - ([1c443ec](https://github.com/baliestri/nuget-code/commit/1c443ec7b359513e78f46403cb969b35e74de5bd))
- *(extension)* Ask for a rating after five days of use - ([1e3d56a](https://github.com/baliestri/nuget-code/commit/1e3d56ab76b982cc580a10878523d7ad9f26b420))

### 📚 Documentation

- *(readme)* Link the published v3 in both stores - ([c4d9c11](https://github.com/baliestri/nuget-code/commit/c4d9c11121f33f255a73351daeb05de25ae74d69))
- *(wiki)* Describe the rating and star notifications - ([c015a66](https://github.com/baliestri/nuget-code/commit/c015a66a3ac0621f440b01cf6095623828b9e48c))
- *(wiki)* Describe the rating notification - ([edcff9e](https://github.com/baliestri/nuget-code/commit/edcff9e80d5053793c91d17d8df0bc08fec58ee1))

## [3.0.0](https://github.com/baliestri/nuget-code/compare/v2.0.0..v3.0.0) - 2026-11-15

### ⛰️  Features

- *(backend)* Report known vulnerabilities of the resolved packages - ([f9e1337](https://github.com/baliestri/nuget-code/commit/f9e1337b135d7bdad218abcf34f47858b3975188))
- *(backend)* List transitive packages and their newest versions - ([04c9394](https://github.com/baliestri/nuget-code/commit/04c93943ebf731435a2baff27a3837c8460c786a))
- *(backend)* Clear NuGet cache folders - ([d9eabfc](https://github.com/baliestri/nuget-code/commit/d9eabfc6028d8cb0555ca390a2a47d5f4f9ca5e8))
- *(backend)* Write NuGet sources and folder properties - ([3d1095e](https://github.com/baliestri/nuget-code/commit/3d1095e14e88b5e7926dd5ac1101a5b3d882a834))
- *(backend)* Restore on solution open and cancel running operations - ([06e3301](https://github.com/baliestri/nuget-code/commit/06e33018bb8351fda1ca90f72104219f66be99c8))
- *(backend)* Install, update and remove packages - ([31340e0](https://github.com/baliestri/nuget-code/commit/31340e0c044f360771d95064339bec901e56146b))
- *(backend)* Add MSBuild and console restore engines with automatic fallback - ([c7ed957](https://github.com/baliestri/nuget-code/commit/c7ed957cfbf375e2e04c6c8ff35842ac29435f5f))
- *(backend)* Restore in process with the embedded engine - ([d523cc3](https://github.com/baliestri/nuget-code/commit/d523cc371995a72019bd14b2af3797e29d0b1646))
- *(backend)* Add the operation queue and packages/plan - ([0272510](https://github.com/baliestri/nuget-code/commit/0272510a9b17d86b1ed563807c03daca43d19540))
- *(backend)* Plan package installs and removals as text edits - ([8d1daf6](https://github.com/baliestri/nuget-code/commit/8d1daf6c4895c060e0bb205fdfabc89ee475c294))
- *(backend)* Plan package version updates as text edits - ([e451cb5](https://github.com/baliestri/nuget-code/commit/e451cb5bb19b99a173c8f2a1b7ae414285d279ea))
- *(backend)* Add span-aware XML parsing and lossless text documents - ([27b4c1c](https://github.com/baliestri/nuget-code/commit/27b4c1cd6a2e88ea71689a0cc0bc42b03ba51f83))
- *(backend)* Ask the host for feed credentials - ([14f364d](https://github.com/baliestri/nuget-code/commit/14f364dcad5d4fe901b8b4d0ec4199499b97d892))
- *(backend)* Report the newest version of installed packages - ([5c44047](https://github.com/baliestri/nuget-code/commit/5c440479a3fa025d9301f54d6a003c05144312ac))
- *(backend)* Search feeds and read package details - ([d0cc468](https://github.com/baliestri/nuget-code/commit/d0cc468747dca01eaf303d8d4b0385dc67032635))
- *(backend)* Re-evaluate projects when workspace files change - ([4bca2c8](https://github.com/baliestri/nuget-code/commit/4bca2c86c2af2af0fb43a3bcbfb594030508ea61))
- *(backend)* Locate where each package version is declared - ([2d6a454](https://github.com/baliestri/nuget-code/commit/2d6a454df08f7329d3414b37be14668f937e6b24))
- *(backend)* Evaluate projects and list installed packages - ([d8bf0c5](https://github.com/baliestri/nuget-code/commit/d8bf0c56d5c380831aa389753a74dfc9ed87ba15))
- *(backend)* Read solutions and track the selected session - ([66cef9e](https://github.com/baliestri/nuget-code/commit/66cef9ed2ab09dd1e47123d5410b38a3e8a9760d))
- *(backend)* Expose NuGet sources and folders - ([df1635e](https://github.com/baliestri/nuget-code/commit/df1635e92080fb0f94b4a43196e68faa7ffb045d))
- *(backend)* Stream masked log entries to the host - ([ceabe66](https://github.com/baliestri/nuget-code/commit/ceabe6629a3f3937f8ee9f8a90d07d36b42745ab))
- *(backend)* Locate the .NET SDK and run cancellable child processes - ([a934bb2](https://github.com/baliestri/nuget-code/commit/a934bb2104b3bef8f74ca946216e93c4395495c6))
- *(backend)* Add stdio host, lifecycle methods and AOT test harness - ([1920168](https://github.com/baliestri/nuget-code/commit/19201687ef8d6071f8f27ec83435df77054c0bfc))
- *(backend)* Add JSON-RPC dispatcher with cancellation - ([7ee9ae0](https://github.com/baliestri/nuget-code/commit/7ee9ae0b649ba00a20789cb8c18e701d949e9fbe))
- *(backend)* Add projects and Content-Length message framing - ([4b29c10](https://github.com/baliestri/nuget-code/commit/4b29c10536170af0c0f1e54fdada001d1743b275))
- *(backend-client)* Restart a crashed backend within a limit - ([2ddb449](https://github.com/baliestri/nuget-code/commit/2ddb449b10fcfb40215c359369633252aa457beb))
- *(backend-client)* Start the backend and call it with types - ([64ff03d](https://github.com/baliestri/nuget-code/commit/64ff03d877b351755596fcd572752ac4e0484455))
- *(bridge)* Typed requests and events between the webview and the host - ([284e715](https://github.com/baliestri/nuget-code/commit/284e715ef24b6d52a4d4f2775353374af34cdc02))
- *(console)* Install, uninstall, update and sync packages - ([09e5766](https://github.com/baliestri/nuget-code/commit/09e57662c928a00eb7447113707ddc4e98344217))
- *(console)* A PowerShell module with the read cmdlets - ([df4bd56](https://github.com/baliestri/nuget-code/commit/df4bd561bb718a2bc0967e04f5f0942b95113ba5))
- *(extension)* Open the package manager console in a terminal - ([6479ca6](https://github.com/baliestri/nuget-code/commit/6479ca6fcea12145da0599d3f58da4beae3d2377))
- *(extension)* Find PowerShell 7 and offer to install it - ([0f5a070](https://github.com/baliestri/nuget-code/commit/0f5a070ecf00c77839653e0144ab61d21674ccab))
- *(extension)* A local channel for the package manager console - ([2bb4d39](https://github.com/baliestri/nuget-code/commit/2bb4d39c5e62b57f375842c6aa7426e25be74cfc))
- *(extension)* A setting to turn the vulnerability check off - ([2ad7929](https://github.com/baliestri/nuget-code/commit/2ad7929c2789c7be679f8d39f429a383d5e773d8))
- *(extension)* Open the folder of a restored package and copy a text for the view - ([12a79e8](https://github.com/baliestri/nuget-code/commit/12a79e83e33f13edcb37a53a5ab0e9bd2a7ecf5b))
- *(extension)* Remember the folder sizes for the whole machine - ([7e1a0e5](https://github.com/baliestri/nuget-code/commit/7e1a0e5158cd7a65503902d800bbfb0b44ff0f4c))
- *(extension)* Notify operation warnings and say the backend state in the status bar - ([f2c820c](https://github.com/baliestri/nuget-code/commit/f2c820ce82a26b92cb7b8c9d89c6691dacae056b))
- *(extension)* Host the NuGet view in the panel - ([1e28aa2](https://github.com/baliestri/nuget-code/commit/1e28aa2aee2b3124abe345dff583a3da24a875ea))
- *(extension)* Add the maintenance commands and wire watchers and credentials - ([ce294cb](https://github.com/baliestri/nuget-code/commit/ce294cb2a4c7b9aee6be55771e0c828772ba9c61))
- *(extension)* Answer credential requests from secret storage - ([4d41e67](https://github.com/baliestri/nuget-code/commit/4d41e67b89f7c55aca17615007768c01dce6aa7d))
- *(extension)* Report file changes to the backend in batches - ([ce0bb27](https://github.com/baliestri/nuget-code/commit/ce0bb2721906a59c2b7a1572fab13af0eaa96615))
- *(extension)* Discover solutions and pick one - ([3cc8742](https://github.com/baliestri/nuget-code/commit/3cc8742ad08c613582c2defd8c8bb886f8d411f5))
- *(extension)* Activate, start the backend and show its log - ([a6f4368](https://github.com/baliestri/nuget-code/commit/a6f4368ddf80a49552c6e8ace96944b822afbdc2))
- *(package)* Ship the changelog in the VSIX - ([b94b33e](https://github.com/baliestri/nuget-code/commit/b94b33ee9dddb1176be3ec71af9e157adf70ffa0))
- *(protocol)* Describe the backend contract in TypeScript - ([aea7d0f](https://github.com/baliestri/nuget-code/commit/aea7d0fbf0f90fa7cb0087c39352d68fde0bd818))
- *(scripts)* Set the extension version from the command line - ([28473ed](https://github.com/baliestri/nuget-code/commit/28473edb224cc4557f8cb6b8ca57d8ceb9b6692a))
- *(webview)* Warn about packages with known vulnerabilities - ([bb3755b](https://github.com/baliestri/nuget-code/commit/bb3755bd4a90330ae551ef95a23ac12a04f10dca))
- *(webview)* List the implicitly installed packages - ([69366ff](https://github.com/baliestri/nuget-code/commit/69366ff63d324521b86d77b0d1ccd36862abd77e))
- *(webview)* The context menu of a package - ([e10c2dc](https://github.com/baliestri/nuget-code/commit/e10c2dcbad2eb27d166e0727b529d8aaf896ba67))
- *(webview)* A context menu in the style of the editor's menus - ([6084448](https://github.com/baliestri/nuget-code/commit/60844481507cd7fcd1b851bb425b4cdf5ad5f933))
- *(webview)* Remember the measured folder sizes - ([0933b63](https://github.com/baliestri/nuget-code/commit/0933b63806f416efc6cdf02786b3f584cb567d27))
- *(webview)* Report a cleared cache as a notification of the editor - ([e3e7565](https://github.com/baliestri/nuget-code/commit/e3e75650325d3a47c53dacc2c6e7afdb85feb657))
- *(webview)* Show the backend log - ([4b89736](https://github.com/baliestri/nuget-code/commit/4b8973619183588f2f7905fd20151e809c930c81))
- *(webview)* List, measure and clear NuGet folders - ([3902eb4](https://github.com/baliestri/nuget-code/commit/3902eb40f084a3d526b3c5665d32f7a9063fdf39))
- *(webview)* Manage package sources - ([385d891](https://github.com/baliestri/nuget-code/commit/385d891390db7ae45cd9a08ab4fd6d24d59be363))
- *(webview)* Fold a group by its title and show file icons in the target list - ([52cb2c2](https://github.com/baliestri/nuget-code/commit/52cb2c2e4176134d6269253abb28a5e0e0be68d1))
- *(webview)* Run package operations and report how they ended - ([061ff55](https://github.com/baliestri/nuget-code/commit/061ff5594faac69304cb4663bd3f83e3f86a5a27))
- *(webview)* Installed packages, discover and package details - ([82cbc90](https://github.com/baliestri/nuget-code/commit/82cbc9053ca56389f540d0590b4b662904994bae))
- *(webview)* Bundle the icon assets - ([26bc519](https://github.com/baliestri/nuget-code/commit/26bc51945d0de46657841e2ed91c6a630ced2644))
- *(webview)* NuGet version ordering and the package list model - ([28047d2](https://github.com/baliestri/nuget-code/commit/28047d23d7b6ae0d2fa4009abed770d4398347ae))
- *(webview)* Shell, theme and development page - ([a276870](https://github.com/baliestri/nuget-code/commit/a2768704cf2b407734acd7659220ce7f9832f4c4))

### 🐛 Bug Fixes

- *(backend)* Do not replace a read-only file and keep file permissions - ([04eafc5](https://github.com/baliestri/nuget-code/commit/04eafc5d287f91827fa4c08a5b59ffca3b70a851))
- *(backend)* Match an unauthorized feed by its server, not its index URL - ([8b8b41b](https://github.com/baliestri/nuget-code/commit/8b8b41b7f03924d7a7844a0e818cfc460b59fdae))
- *(backend-client)* Stay stopped when the launch cannot name a binary - ([122e59c](https://github.com/baliestri/nuget-code/commit/122e59c2b999312a10cfe7278137abcff2ae1573))
- *(extension)* Write Windows drive letters in upper case - ([25657eb](https://github.com/baliestri/nuget-code/commit/25657eb6b9ebcdd676c65c5432c217f8b44b0378))
- *(extension)* Keep the editor smoke tests out of the unit test run - ([b63e061](https://github.com/baliestri/nuget-code/commit/b63e0613262e0f949259606d7c59aa4f8d3960f3))
- *(package)* Build the view into the VSIX - ([6a8f534](https://github.com/baliestri/nuget-code/commit/6a8f5342218d1e5317db9743af4cb8c94691704e))
- *(release)* Recover delayed Open VSX publication - ([cc1ce08](https://github.com/baliestri/nuget-code/commit/cc1ce087d5238e82f9c0fd20c66a260b12152ca4))
- *(release)* Recover delayed Marketplace publication - ([805c638](https://github.com/baliestri/nuget-code/commit/805c638136e5acbade81ac36451a9484f30c6933))
- *(webview)* Say why a folder could not be measured or opened - ([a99c980](https://github.com/baliestri/nuget-code/commit/a99c9804327e0bb13ab958e5c91be6c307c96454))

### 🚜 Refactor

- *(backend)* Locate package declarations through XML spans - ([0f0ee23](https://github.com/baliestri/nuget-code/commit/0f0ee231e2436b6e7de85e9b7033ee780eddac14))
- *(backend)* Name cancellation token parameters ct - ([efb5706](https://github.com/baliestri/nuget-code/commit/efb5706468c3603c1edc6b478e39db6220c303b4))

### 📚 Documentation

- *(backend)* Describe read-only files and the local Alpine run - ([be8ad1c](https://github.com/baliestri/nuget-code/commit/be8ad1c49df3d057e938214993cc3b7f3208441d))
- *(backend)* Document operations, restore and package editing - ([fad3c2a](https://github.com/baliestri/nuget-code/commit/fad3c2a4285e1e05571ce1e0533e5876fb50084a))
- *(backend)* Document the protocol and how to build and test - ([ecb8594](https://github.com/baliestri/nuget-code/commit/ecb8594aaaeabf19332d9257edf300c15207fe24))
- *(changelog)* Generate the changelog with git-cliff - ([5543004](https://github.com/baliestri/nuget-code/commit/5543004f43eace8348718a67bf4fe873c3f81183))
- *(contributing)* Describe releasing and dependency updates - ([6b6ff54](https://github.com/baliestri/nuget-code/commit/6b6ff5466e7bd096fd139e01f3991aeaf0726982))
- *(extension)* Document the extension host - ([b72e6a7](https://github.com/baliestri/nuget-code/commit/b72e6a70a35b83605ec69d9619f12f899180ae95))
- *(license)* Relicense under the zlib/libpng license - ([cab6b94](https://github.com/baliestri/nuget-code/commit/cab6b943458cf8cbb429a0ac525d4ce733e0dab8))
- *(readme)* Name the extension in its license line - ([93d545a](https://github.com/baliestri/nuget-code/commit/93d545adca11e3d754e9062a1ce5409adc0aea73))
- *(readme)* Correct the advice about a feed that stops asking for credentials - ([2e196fa](https://github.com/baliestri/nuget-code/commit/2e196fafeb3aa7792e58c1ab1537acfc0bee48b0))
- *(readme)* Present the view in the repository and marketplace readmes - ([cf9059d](https://github.com/baliestri/nuget-code/commit/cf9059d5675ee2b804deab83bc113ef41572f1a3))
- *(readme)* Reduce README to a stub pending the rewrite - ([ae66dac](https://github.com/baliestri/nuget-code/commit/ae66dacc0db73ffff79c413503119fccf2cd322e))
- *(wiki)* A reference page for the NuGet view - ([53a4dd4](https://github.com/baliestri/nuget-code/commit/53a4dd4b2268ee785574c4f8763f89808bb9ffec))
- Describe the package manager console - ([8442426](https://github.com/baliestri/nuget-code/commit/844242689a088cf63b210cee0d61f44419298473))
- Describe transitive packages and vulnerability warnings - ([f7cd581](https://github.com/baliestri/nuget-code/commit/f7cd581a056db5ceb83573154aefac3fd3e834e0))
- Describe the view - ([c869f8f](https://github.com/baliestri/nuget-code/commit/c869f8ff81dd9a0efdc50f9c3d719c478d5a2396))
- State what has been verified on each platform - ([7f26dd0](https://github.com/baliestri/nuget-code/commit/7f26dd0b4af598e9d77d1d423df5ddf984d1f352))

### 🎨 Styling

- *(backend)* Apply cleanup formatting to NuGet.config - ([5230bda](https://github.com/baliestri/nuget-code/commit/5230bda3044cc24f2d11de266ef63c491ded74bd))
- Apply the formatter's semicolon and trailing comma settings - ([e19a8ee](https://github.com/baliestri/nuget-code/commit/e19a8ee27387d4fc1f820a7abc450a821b827d20))
- Format tracked files with oxfmt - ([b6a2f6a](https://github.com/baliestri/nuget-code/commit/b6a2f6adbaacaba42ff243f4262782d17b0b4195))

### 🧪 Testing

- *(backend)* Follow symbolic links in the temporary test directory - ([8e85f93](https://github.com/baliestri/nuget-code/commit/8e85f934583498a9d59b7770ab072cd155a61ccb))
- *(backend)* Cover HTTP V3, V2 and source mapping against the AOT binary - ([8995875](https://github.com/baliestri/nuget-code/commit/8995875835c30a56baf6f4b073c574b39090de73))
- *(extension)* Type the console commands again until the shell answers - ([14cdc9f](https://github.com/baliestri/nuget-code/commit/14cdc9f341f09b666c90a805835770ee94668c8b))
- *(extension)* Ask for the folder sizes as the view does - ([2eaa1ef](https://github.com/baliestri/nuget-code/commit/2eaa1efc67a87f28f770cfa9a643a185caccd9f7))
- *(extension)* Smoke-test activation and restore in the editor - ([0ffbcf5](https://github.com/baliestri/nuget-code/commit/0ffbcf5f917ffe51fd5c39cd00fb2656327bc188))
- Close the test feed server without giving the port back first - ([c3f2c95](https://github.com/baliestri/nuget-code/commit/c3f2c9544bfb0fb9173919ff0bc5214c4e85da78))
- Wait for the log instead of expecting it at a given moment - ([c257e8f](https://github.com/baliestri/nuget-code/commit/c257e8fae6bb1cb48192a3834330f974fff29758))

### ⚙️ Miscellaneous Tasks

- *(backend)* Track Rider solution settings - ([65ad6f2](https://github.com/baliestri/nuget-code/commit/65ad6f275ee8a613639a2a77234feaa637bbf072))
- *(backend)* Add .NET build configuration - ([79fde7b](https://github.com/baliestri/nuget-code/commit/79fde7b1b9f79d665046ee521fa8bbb0a7071923))
- *(dependabot)* Leave the .NET SDK, runtime packages' majors and the editor's API types to be raised by hand - ([84c823f](https://github.com/baliestri/nuget-code/commit/84c823f304ad6f420750cce6b39838c4b635f28e))
- *(editorconfig)* Move the .NET conventions next to the backend - ([5cd20c7](https://github.com/baliestri/nuget-code/commit/5cd20c788a7d41e215f23f8e30fbb2a44d100f1d))
- *(editorconfig)* Add repository-wide editor and C# conventions - ([0c50d11](https://github.com/baliestri/nuget-code/commit/0c50d11f3afd9e121bae7e732bb0120d6e7538e0))
- *(gitignore)* Cover .NET, Visual Studio and VS Code artifacts - ([1dfb6c7](https://github.com/baliestri/nuget-code/commit/1dfb6c7ed59c70978591c680b1b8721f3accce9d))
- *(release)* Start by dispatch on a tag and take the notes from the changelog - ([1dab6fd](https://github.com/baliestri/nuget-code/commit/1dab6fd00a9829e96512d4e76f28f3f32de1ef49))
- *(release)* Prepare, validate and promote a release from a version - ([4f32c35](https://github.com/baliestri/nuget-code/commit/4f32c356768dc83434a6ebb77cedebf9302b6c1f))
- *(vscode)* Launch and task configurations for running the extension - ([ac584b0](https://github.com/baliestri/nuget-code/commit/ac584b0c7b47d1928a539228a973852462f359fd))
- *(workspace)* Point root scripts at files that exist - ([70e6064](https://github.com/baliestri/nuget-code/commit/70e60640f9517fc54b5529119832c3532100490a))
- Watch dependencies with Dependabot and a weekly audit - ([874bf49](https://github.com/baliestri/nuget-code/commit/874bf4934e38ef28ba04af34944911590c1f854f))
- Let the CI run on a given commit - ([0bfddce](https://github.com/baliestri/nuget-code/commit/0bfddcebe5e8a1338cd25ec7d2e68054b8386dd9))
- Run the bridge and view tests - ([321a4e2](https://github.com/baliestri/nuget-code/commit/321a4e28875a5f58ca6e5e26d53ece4b708743d1))
- Extract the VSIX with the system tar on Windows - ([9257826](https://github.com/baliestri/nuget-code/commit/92578266b5c449cf43080234280f0525b94a86d6))
- Publish to the Marketplace with trusted publishing only - ([4d88eff](https://github.com/baliestri/nuget-code/commit/4d88eff0039821c55d9bd922b73f2464fcfefc75))
- Publish with trusted publishing instead of long-lived tokens - ([eaa2c60](https://github.com/baliestri/nuget-code/commit/eaa2c601c79126dd3237da9f4af9f5d29a6c56cb))
- Build, test and package every target - ([df583e8](https://github.com/baliestri/nuget-code/commit/df583e8d6b22f3cc3c5e2adff2fa9a4cbad05157))
- [**breaking**] Remove the v2 extension sources ahead of the rewrite - ([23452a4](https://github.com/baliestri/nuget-code/commit/23452a4055bd3281f277e1647ba5d6ce46fe0f18))

### Build

- *(extension)* Package one VSIX per target - ([07dd5e0](https://github.com/baliestri/nuget-code/commit/07dd5e0eeb65fda31a49250a97953768846a6eab))
- *(tooling)* Replace eslint and prettier with oxlint and oxfmt - ([2d2baba](https://github.com/baliestri/nuget-code/commit/2d2baba6ddce06c055e426fbb039c2232b2aec70))
- Ship the console module in the VSIX - ([b57cc64](https://github.com/baliestri/nuget-code/commit/b57cc64be915c1c5f2edde934ebac4b83ae94699))

## New Contributors ❤️

* @dependabot[bot] made their first contribution
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
