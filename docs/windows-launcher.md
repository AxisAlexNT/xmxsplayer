# Windows portable launcher

The application remains MIT-licensed. The portable EXE also distributes independently licensed NSIS components. StdUtils is LGPL-2.1-or-later with its author's NSIS clarification; Nsis7z's upstream notice specifies LGPL and includes public-domain LZMA SDK code. These components are unmodified DLLs extracted and called through the NSIS plug-in interface. The ZIP runs the application directly without this launcher.

## Shipped components and notices

- NSIS toolset 3.0.4.1: core, `System.dll` and `elevate.exe`, Copyright (C) 1999–2018 Contributors. See [NSIS COPYING](licenses/NSIS-COPYING.txt). The observed outer EXE uses Deflate, covered by zlib/libpng terms; COPYING also retains upstream's notices for other compression modules.
- StdUtils 1.14 (DLL version 1.1.4.0), Copyright (C) 2004–2018 LoRd_MuldeR. See [notice](licenses/StdUtils-notice.txt), [LGPL-2.1](licenses/launcher-LGPL-2.1.txt), [clarification](licenses/StdUtils-clarification.txt), and its [RHash](licenses/StdUtils-RHash.txt) and [BLAKE2](licenses/StdUtils-BLAKE2.txt) notices.
- Nsis7z 19.00, by Nik Medved, Marek Mizanin and Stuart Welch, using Igor Pavlov's code. See its [original copyright, license and build notice](licenses/Nsis7z-notice.txt), [LGPL-2.1 text](licenses/launcher-LGPL-2.1.txt), and [LZMA SDK public-domain notice](licenses/LZMA-SDK.txt).

Modification and reverse engineering for debugging modifications to the LGPL components are permitted. No application term prohibits replacing them or rebuilding the launcher. No signing or integrity restriction is added to prevent replacement. Sources below are supplied with every application package and as separate release attachments; preserve them and these notices when redistributing the EXE.

## Corresponding sources

These are verbatim upstream archives, including project/build files. No network access is needed to obtain the plug-in sources from a packaged copy. In an extracted application they are inside `resources/app.asar`, under `docs/licenses/launcher-sources/`; an ASAR extraction tool can recover them. The same files are also in this repository and attached separately to release drafts.

| Archive | Upstream download | SHA-256 |
| --- | --- | --- |
| [StdUtils.2018-10-27.sources.tbz2](licenses/launcher-sources/StdUtils.2018-10-27.sources.tbz2) | [StdUtils 1.14](https://github.com/lordmulder/stdutils/releases/download/1.14/StdUtils.2018-10-27.sources.tbz2) | `c5e3b1a66219bc9564c2ccc1702691327eecf044ad33404ac268d725d22dca49` |
| [Nsis7z_19.00.7z](licenses/launcher-sources/Nsis7z_19.00.7z) | [Nsis7z 19.00](https://nsis.sourceforge.io/mediawiki/images/6/69/Nsis7z_19.00.7z) | `6f2f3730049926f40442ee0c8b7d3e3dee7ace544d82467ff8059ea3f4201c58` |
| [lzma1900.7z](licenses/launcher-sources/lzma1900.7z) | [LZMA SDK 19.00](https://www.7-zip.org/a/lzma1900.7z) | `00f569e624b3d9ed89cf8d40136662c4c5207eaceb92a70b1044c77f84234bad` |

The x86 Unicode DLLs in the upstream binary packages match electron-builder's cached DLLs byte for byte:

| DLL | SHA-256 |
| --- | --- |
| `StdUtils.dll` | `b72e9013a6204e9f01076dc38dabbf30870d44dfc66962adbf73619d4331601e` |
| `nsis7z.dll` | `b393f05e8ff919ef071181050e1873c9a776e1a0ae8329aefff7007d0cadf592` |

The comparison uses `Plugins/Unicode/StdUtils.dll` from [the StdUtils binary ZIP](https://github.com/lordmulder/stdutils/releases/download/1.14/StdUtils.2018-10-27.zip) (ZIP SHA-256 `3ffe893dc7477fdb1cac551a86ae017509e1f2d0ebdc7185fd0fbaf20870688c`) and `Plugins/x86-unicode/nsis7z.dll` from the supplied Nsis7z archive. Inspect the final EXE's `$PLUGINSDIR` entries with 7-Zip and recheck these hashes whenever packaging dependencies change. Update sources and notices together if any component changes.

## Rebuild or replace

1. Extract the StdUtils source archive. Open `Contrib/StdUtils/StdUtils.sln` in a Windows Visual C++ build environment and select `Release_Unicode`, platform `Win32`. Its project uses the older Visual C++ upgrade property sheets and import libraries supplied in `Contrib/StdUtils/lib`; a newer toolchain may require retargeting. Preserve the plug-in ABI and exports.
2. Extract Nsis7z, then copy the `C` and `CPP` directories from LZMA SDK 19.00 into `Contrib/nsis7z/`, merging directories as its version-specific notice instructs. Open `Contrib/nsis7z/CPP/7zip/Bundles/Nsis7z/Nsis7z.sln` with Visual Studio 2017 and select `Release Unicode`, `Win32`. Use the 19.00 instructions rather than the notice's older ANSI-only instructions.
3. Copy electron-builder's `nsis-resources-3.4.1` bundle to a writable directory, retaining the complete `plugins` tree. Replace `plugins/x86-unicode/StdUtils.dll` and/or `plugins/x86-unicode/nsis7z.dll` with compatible builds. Use a copy so the shared build cache is preserved.
4. In a checkout of this application's matching source revision, run `npm ci`. Set `ELECTRON_BUILDER_NSIS_RESOURCES_DIR` to that copied bundle's absolute path, then run `npm run dist:win -- --publish never`. The installed builder supports this override and locates its `plugins` directory. The launcher script and includes are in `node_modules/app-builder-lib/templates/nsis/portable.nsi` and adjacent include files; their source is available with the locked builder dependency. The rebuild does not need a signing key.
5. Test the rebuilt launcher on Windows and distribute the modified library sources, notices and build changes alongside it as required by the licenses. The portable launcher is x86 Unicode even though the application payload is x64. Alternatively, use the ZIP to launch the same application without either plug-in.

Source archive integrity, DLL identity, packaging and archive extraction were checked on Linux. Compiling these legacy C++ projects and executing a rebuilt launcher on Windows remain untested. The original standard portable EXE also awaits Windows runtime QA; a cross-build does not establish Windows operation.
