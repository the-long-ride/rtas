---
name: tauri2-windows-nsis
description: Package and release a Tauri 2 Windows application with NSIS, bundled CLI binaries, resources, signing, updates, and installer smoke tests. Use for Windows distribution work.
---

# Tauri 2 Windows and NSIS

## Binary layout
Prefer separate executables:
- `product-gui.exe`: Windows GUI/Tauri executable.
- `product.exe`: console CLI executable.

This avoids console-subsystem conflicts and keeps CLI output reliable. Share logic through Rust crates or a service protocol.

## Bundling
- Configure the Tauri bundle target for NSIS.
- Bundle additional CLI/service binaries through supported external binary or resource configuration.
- Verify target-triple naming and final installed paths.
- Do not assume the development directory layout exists after installation.
- Resolve resources through Tauri/application path APIs.

## PATH
Do not modify PATH silently. Make CLI exposure an explicit installer choice, install a documented shim, or provide a command that explains how to add it.

## Release safety
- Build on a clean Windows runner.
- Sign release binaries and installer artifacts.
- Sign updater artifacts when updates are enabled.
- Preserve protocol compatibility between GUI and service binaries.
- Test install, upgrade, repair/reinstall, uninstall, spaces in paths, and non-admin installation.

## Proof
Run the installed GUI and CLI from outside the source tree. Confirm bundled resources, service startup, logs, and uninstall cleanup.

## Routing
Pair with `cli-gui-service-bridge` for bundled service behavior and `change-verification` for release proof.
